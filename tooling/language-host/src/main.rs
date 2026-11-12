//! Zed installers and WASI extensions; Setdown retains ownership of all documents.
use std::{ffi::OsStr, io::{self, BufRead, Read, Write}, path::{Path, PathBuf}, sync::Arc};
use anyhow::{Context as _, Result, bail, ensure};
use async_trait::async_trait;
use collections::HashMap;
use extension::ExtensionHostProxy;
use extension_host::headless_host::{ExtensionVersion, HeadlessExtensionStore};
use gpui::{App, AppContext as _, AsyncApp, BackgroundExecutor, EntityId, SharedString, UpdateGlobal as _};
use http_client::HttpClient;
use language::{BinaryStatus, LanguageName, LanguageRegistry, LspAdapter, LspAdapterDelegate};
use lsp::{LanguageServerBinary, LanguageServerBinaryOptions, LanguageServerName};
use node_runtime::{NodeBinaryOptions, NodeRuntime};
use serde::Deserialize;
use serde_json::{Value, json};
use settings::{Settings as _, SettingsStore, WorktreeId};
use util::rel_path::RelPath;
use streaming_iterator::StreamingIterator as _;
use futures::FutureExt as _;

struct HostHttp(reqwest_client::ReqwestClient);
impl HttpClient for HostHttp {
    fn user_agent(&self) -> Option<&http_client::http::HeaderValue> { self.0.user_agent() }
    fn proxy(&self) -> Option<&http_client::Url> { self.0.proxy() }
    fn send(&self, request: http_client::Request<http_client::AsyncBody>) -> futures::future::BoxFuture<'static, Result<http_client::Response<http_client::AsyncBody>>> {
        let future = self.0.send(request);
        async move { future.await.inspect_err(|error| eprintln!("Language package HTTP request failed: {error:#}")) }.boxed()
    }
}

const PREFIX: &str = "SETDOWN-LANGUAGE/1 ";
fn emit(value: Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{PREFIX}{value}");
    let _ = out.flush();
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    id: u64, op: String,
    #[serde(default)] server: String,
    #[serde(default)] language: String,
    #[serde(default)] root: PathBuf,
    #[serde(default)] env: HashMap<String, String>,
    #[serde(default)] settings: Value,
    #[serde(default)] extensions: Vec<InstalledExtension>,
    #[serde(default)] package: String,
    #[serde(default)] version: String,
    #[serde(default)] command: String,
    #[serde(default)] extension: String,
    #[serde(default)] config: String,
    #[serde(default)] text: String,
    #[serde(default = "enabled")] allow_binary_download: bool,
    #[serde(default)] inherit_environment: bool,
}
fn enabled() -> bool { true }
#[derive(Deserialize)]
struct InstalledExtension { id: String, version: String }
struct Delegate {
    request_id: u64, root: PathBuf, env: HashMap<String, String>,
    http: Arc<dyn HttpClient>, executor: BackgroundExecutor,
    registry: Arc<LanguageRegistry>, entity: EntityId,
}
#[async_trait]
impl LspAdapterDelegate for Delegate {
    fn show_notification(&self, message: &str, _: &mut App) { emit(json!({"event":"message","id":self.request_id,"message":message})); }
    fn http_client(&self) -> Arc<dyn HttpClient> { self.http.clone() }
    fn background_executor(&self) -> &BackgroundExecutor { &self.executor }
    fn worktree_id(&self) -> WorktreeId { WorktreeId::from_usize(1) }
    fn worktree_root_path(&self) -> &Path { &self.root }
    fn resolve_relative_path(&self, path: PathBuf) -> PathBuf { self.root.join(path) }
    fn status_source_id(&self) -> EntityId { self.entity }
    fn update_status(&self, server: LanguageServerName, status: BinaryStatus) {
        emit(json!({"event":"status","id":self.request_id,"server":server.0,"status":format!("{status:?}")}));
    }
    fn registered_lsp_adapters(&self) -> Vec<Arc<dyn LspAdapter>> { self.registry.all_lsp_adapters().iter().map(|a| a.adapter.clone()).collect() }
    async fn language_server_download_dir(&self, name: &LanguageServerName) -> Option<Arc<Path>> {
        let dir = self.registry.language_server_download_dir(name)?;
        smol::fs::create_dir_all(&dir).await.ok()?;
        Some(dir)
    }
    async fn npm_package_installed_version(&self, name: &str) -> Result<Option<(PathBuf, semver::Version)>> {
        for parent in self.root.ancestors() {
            let modules = parent.join("node_modules");
            if let Ok(text) = smol::fs::read_to_string(modules.join(name).join("package.json")).await {
                let package: Value = serde_json::from_str(&text)?;
                if let Some(version) = package["version"].as_str() { return Ok(Some((modules, version.parse()?))); }
            }
        }
        Ok(None)
    }
    async fn which(&self, command: &OsStr) -> Option<PathBuf> { which::which_in(command, self.env.get("PATH"), &self.root).ok() }
    async fn shell_env(&self) -> HashMap<String, String> { self.env.clone() }
    async fn read_text_file(&self, path: &RelPath) -> Result<String> { Ok(smol::fs::read_to_string(self.root.join(path.as_std_path())).await?) }
    async fn try_exec(&self, binary: LanguageServerBinary) -> Result<()> {
        let output = util::command::new_command(&binary.path).args(binary.arguments)
            .env_clear().envs(&self.env).envs(binary.env.unwrap_or_default()).current_dir(&self.root).output().await?;
        ensure!(output.status.success(), "Executable check failed: {}", output.status);
        Ok(())
    }
}
/// Windows usually spells the variable `Path`, while Zed's adapters and `which` read `PATH`.
/// Zed renames it after its shell capture (project/src/environment.rs), which Windows skips here.
fn normalize_path(mut env: HashMap<String, String>) -> HashMap<String, String> {
    if cfg!(windows) && !env.contains_key("PATH") {
        let key = env.keys().find(|key| key.eq_ignore_ascii_case("PATH")).cloned();
        if let Some(path) = key.and_then(|key| env.remove(&key)) { env.insert("PATH".into(), path); }
    }
    env
}
fn merge(base: &mut Value, extra: Value) {
    if let (Some(base), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra { merge(base.entry(key).or_insert(Value::Null), value.clone()); }
    } else if !extra.is_null() { *base = extra; }
}
struct SyntaxGrammar { language: tree_sitter::Language, query: tree_sitter::Query }
fn highlight(request: &Request, data: &Path, grammars: &mut HashMap<String, SyntaxGrammar>) -> Result<Value> {
    ensure!(request.text.len() <= 2 * 1024 * 1024, "Syntax document exceeds 2 MiB");
    ensure!(request.extension.chars().all(|c|c.is_ascii_alphanumeric() || "._-".contains(c)) && !request.extension.contains(".."), "Invalid extension");
    let dir = data.join("extensions").join(&request.extension);
    let config_path = dir.join(&request.config).canonicalize()?;
    ensure!(config_path.starts_with(dir.canonicalize()?), "Invalid language configuration path");
    let key = config_path.to_string_lossy().to_string();
    if !grammars.contains_key(&key) {
        let config: language::LanguageConfig = toml::from_str(&std::fs::read_to_string(&config_path)?)?;
        let grammar_name = config.grammar.context("Language has no grammar")?;
        ensure!(grammar_name.chars().all(|c|c.is_ascii_alphanumeric() || "_-".contains(c)), "Invalid grammar name");
        let wasm = std::fs::read(dir.join("grammars").join(format!("{grammar_name}.wasm")))?;
        let language = language::with_parser(|parser| {
            let mut store = parser.take_wasm_store().context("Missing Tree-sitter WASM store")?;
            let result = store.load_language(&grammar_name, &wasm);
            parser.set_wasm_store(store)?;
            Ok::<_,anyhow::Error>(result?)
        })?;
        let source = std::fs::read_to_string(config_path.parent().unwrap().join("highlights.scm"))?;
        let query = tree_sitter::Query::new(&language, &source)?;
        grammars.insert(key.clone(), SyntaxGrammar {language,query});
    }
    let grammar = &grammars[&key];
    let tree = language::with_parser(|parser| {
        parser.set_language(&grammar.language)?;
        parser.parse(&request.text,None).context("Syntax parsing was cancelled")
    })?;
    let mut offsets = vec![0u32; request.text.len()+1]; let mut utf16 = 0u32;
    for (byte,c) in request.text.char_indices() { offsets[byte]=utf16; utf16+=c.len_utf16() as u32; }
    offsets[request.text.len()]=utf16;
    let mut cursor = tree_sitter::QueryCursor::new();
    let mut captures = cursor.captures(&grammar.query,tree.root_node(),request.text.as_bytes());
    let mut spans = Vec::new();
    while let Some((matched,index)) = captures.next() {
        let capture=matched.captures()[*index];
        spans.push(json!([offsets[capture.node.start_byte()],offsets[capture.node.end_byte()],grammar.query.capture_names()[capture.index as usize]]));
        ensure!(spans.len() <= 100000,"Syntax capture limit exceeded");
    }
    Ok(json!(spans))
}
async fn prepare(request: &Request, registry: &Arc<LanguageRegistry>, delegate: Arc<dyn LspAdapterDelegate>, cx: &mut AsyncApp) -> Result<Value> {
    let name = LanguageServerName::from(request.server.as_str());
    let adapter = registry.adapter_for_name(&name).or_else(|| registry.load_available_lsp_adapter(&name))
        .with_context(|| format!("No Zed adapter registered for {}", request.server))?;
    let options = LanguageServerBinaryOptions { allow_path_lookup: true, allow_binary_download: request.allow_binary_download, pre_release: false };
    let (cached, download) = adapter.clone().get_language_server_command(delegate.clone(), None, options, cx).await.await;
    // A cached version works offline; update checks never delay opening a file.
    let binary = match cached { Ok(binary) => binary, Err(error) => match download { Some(task) => task.await?, None => return Err(error) } };
    let mut initialization = adapter.adapter.clone().initialization_options(&delegate, cx).await?.unwrap_or(json!({}));
    let mut configuration = adapter.adapter.clone().workspace_configuration(&delegate, None, None, cx).await?;
    for other in registry.all_lsp_adapters() {
        if other.name() == name { continue; }
        if let Some(value) = other.adapter.clone().additional_initialization_options(name.clone(), &delegate).await? { merge(&mut initialization, value); }
        if let Some(value) = other.adapter.clone().additional_workspace_configuration(name.clone(), &delegate, cx).await? { merge(&mut configuration, value); }
    }
    Ok(json!({"executable":binary.path,"args":binary.arguments.iter().map(|s|s.to_string_lossy()).collect::<Vec<_>>(),
        "env":binary.env,"languageId":adapter.language_id(&LanguageName::from(SharedString::from(request.language.clone()))),
        "initializationOptions":initialization,"settings":configuration}))
}
async fn prepare_npm(request: &Request, data: &Path, node: &NodeRuntime) -> Result<Value> {
    ensure!(!request.package.is_empty() && !request.version.is_empty(), "A pinned npm package is required");
    ensure!(request.package.chars().all(|c| c.is_ascii_alphanumeric() || "@/_.-".contains(c)) && !request.package.contains(".."), "Invalid npm name");
    ensure!(request.version.chars().all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c)), "Invalid npm version");
    let dir = data.join("npm").join(request.package.replace('/', "--")).join(&request.version);
    let package_dir = dir.join("node_modules").join(&request.package);
    let read_package = || async { Ok::<Value, anyhow::Error>(serde_json::from_str(&smol::fs::read_to_string(package_dir.join("package.json")).await?)?) };
    if read_package().await.is_err() {
        smol::fs::create_dir_all(&dir).await?;
        node.npm_install_packages(&dir, &[(&request.package, &request.version)]).await?;
    }
    let package = read_package().await?;
    let bin = package["bin"].as_str().or_else(|| package["bin"][&request.command].as_str())
        .context("Installed npm package does not expose the requested executable")?;
    let script = smol::fs::canonicalize(package_dir.join(bin)).await?;
    ensure!(script.starts_with(smol::fs::canonicalize(&dir).await?), "npm executable escapes its installation");
    Ok(json!({"executable":node.binary_path().await?,"args":[script],"settings":{},"initializationOptions":{}}))
}
fn main() -> Result<()> {
    // Zed's shell environment capture invokes the current executable with this
    // flag. Keep its quoting, shell handling and noisy-output parsing upstream.
    if std::env::args().nth(1).as_deref() == Some("--printenv") { util::shell_env::print_env(); return Ok(()); }
    let data = PathBuf::from(std::env::args().nth(1).context("Usage: setdown-language-host DATA_DIRECTORY")?);
    ensure!(data.is_absolute(), "Data directory must be absolute");
    std::fs::create_dir_all(&data)?;
    paths::set_custom_data_dir(data.to_str().context("Invalid data path")?);
    let (send, receive) = smol::channel::bounded::<String>(16);
    std::thread::spawn(move || {
        let mut input = io::stdin().lock();
        loop {
            let mut bytes = Vec::new();
            match input.by_ref().take(4 * 1024 * 1024 + 1).read_until(b'\n', &mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(n) if n > 4 * 1024 * 1024 => break,
                _ => if let Ok(line) = String::from_utf8(bytes) { if send.send_blocking(line).is_err() { break; } }
            }
        }
    });
    gpui_platform::headless().run(move |cx| {
        settings::init(cx);
        release_channel::init(release_channel::AppVersion::load("0.1.0", None, None), cx);
        gpui_tokio::init(cx);
        extension::init(cx);
        language::language_settings::AllLanguageSettings::register(cx);
        project::project_settings::ProjectSettings::register(cx);
        let offline = std::env::var_os("SETDOWN_LANGUAGE_HOST_OFFLINE").is_some();
        let http: Arc<dyn HttpClient> = if offline { Arc::new(http_client::BlockedHttpClient) } else { Arc::new(HostHttp(reqwest_client::ReqwestClient::proxy_and_user_agent(http_client::read_proxy_from_env(), "Setdown-language-host/0.1").expect("HTTP client"))) };
        let fs = fs::RealFs::new(None, cx.background_executor().clone());
        let node = NodeRuntime::new(http.clone(), None, watch::channel(Some(NodeBinaryOptions { allow_path_lookup: true, allow_binary_download: !offline, use_paths: None })).1);
        let mut registry = LanguageRegistry::new(cx.background_executor().clone());
        registry.set_language_server_download_dir(data.join("servers"));
        let registry = Arc::new(registry);
        languages::init(registry.clone(), fs.clone(), node.clone(), cx);
        let proxy = ExtensionHostProxy::global(cx);
        language_extension::init(language_extension::LspAccess::Noop, proxy.clone(), registry.clone());
        let extensions = HeadlessExtensionStore::new(fs, http.clone(), data.join("extensions"), proxy, node.clone(), cx);
        let source = cx.new(|_| ());
        cx.spawn(async move |cx| {
            let mut grammars = HashMap::default();
            while let Ok(line) = receive.recv().await {
                let request = match serde_json::from_str::<Request>(&line) { Ok(r) => r, Err(e) => { emit(json!({"error":e.to_string()})); continue; } };
                let result: Result<Value> = async {
                    match request.op.as_str() {
                        "environment" => {
                            ensure!(request.root.is_absolute(), "Workspace root must be absolute");
                            let mut env = if request.inherit_environment || cfg!(windows) { normalize_path(request.env.clone()) } else {
                                let shell = request.env.get("SHELL").cloned().unwrap_or_else(util::shell::get_system_shell);
                                util::shell_env::capture(shell, &[], &request.root).await?
                            };
                            for key in ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH", "SETDOWN_LANGUAGE_HOST_OFFLINE"] { env.remove(key); }
                            Ok(serde_json::to_value(env)?)
                        },
                        "inventory" => Ok(json!({"servers":registry.all_lsp_adapters().iter().map(|a|a.name().0.to_string()).collect::<Vec<_>>(),"languages":registry.language_names()})),
                        "extensions" => {
                            let versions = request.extensions.iter().map(|e| ExtensionVersion { id:e.id.clone(),version:e.version.clone(),dev:false,content_fingerprint:None }).collect();
                            let missing = extensions.update(cx, |store,cx|store.sync_extensions(versions,cx)).await?;
                            ensure!(missing.is_empty(), "Extensions failed to load: {:?}", missing);
                            Ok(json!({"loaded":request.extensions.len()}))
                        },
                        "npm" => prepare_npm(&request, &data, &node).await,
                        "highlight" => highlight(&request,&data,&mut grammars),
                        "prepare" => {
                            ensure!(!offline || !request.allow_binary_download, "Downloads are disabled for this host");
                            ensure!(request.root.is_absolute(), "Workspace root must be absolute");
                            cx.update(|cx| SettingsStore::update_global(cx, |store,cx| { let _ = store.set_user_settings(&json!({"lsp":request.settings}).to_string(),cx); }));
                            let delegate = Arc::new(Delegate { request_id:request.id,root:request.root.clone(),env:normalize_path(request.env.clone()),http:http.clone(),executor:cx.background_executor().clone(),registry:registry.clone(),entity:source.entity_id() });
                            prepare(&request,&registry,delegate,cx).await
                        },
                        _ => bail!("Unknown operation"),
                    }
                }.await;
                emit(match result { Ok(value) => json!({"id":request.id,"result":value}), Err(error) => json!({"id":request.id,"error":format!("{error:#}")}) });
            }
            cx.update(|cx|cx.quit());
        }).detach();
    });
    Ok(())
}
