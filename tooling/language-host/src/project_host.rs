//! Zed's project engine for ordinary code files.
//!
//! Setdown says which folder is open and what each open file currently contains. Zed decides
//! everything else: which servers serve the file, their root, toolchain, environment and
//! settings, when they start, and what they are told about the text. Setdown stays the owner
//! of the text: a buffer here is an analysis copy that is never saved from this process.
use std::{future::Future, path::PathBuf, pin::Pin, sync::Arc, time::Duration};

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use client::{Client, UserStore};
use collections::HashMap;
use fs::Fs;
use futures::{FutureExt as _, channel::oneshot};
use gpui::{App, AppContext as _, AsyncApp, Context, Entity, Subscription, Task, WeakEntity};
use language::{
    Bias, Buffer, BufferEvent, DiagnosticEntry, LanguageRegistry, PointUtf16, RelatedLocation,
    ToPointUtf16 as _, Unclipped, language_settings::AllLanguageSettings,
};
use lsp::{LanguageServer, LanguageServerId};
use node_runtime::NodeRuntime;
use project::{
    LocalProjectFlags, LspStoreEvent, Project, ProjectPath, lsp_store::OpenLspBufferHandle,
    project_settings::ProjectSettings,
};
use proto::update_language_server::Variant;
use serde_json::{Value, json};
use settings::{Settings as _, SettingsLocation, SettingsStore};

use crate::emit;

/// A server's own edit request waits this long for Setdown to apply or refuse it.
const EDIT_ANSWER_TIMEOUT: Duration = Duration::from_secs(120);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// `SchemaRequestServiceErrors.HTTPError` of VS Code's JSON extension: a download that failed.
const SCHEMA_REQUEST_FAILED: i64 = 5;
/// A schema the JSON server asked for waits this long for Setdown to download or refuse it.
const SCHEMA_ANSWER_TIMEOUT: Duration = Duration::from_secs(60);

/// `vscode/content`: the JSON server asks its editor for a schema it does not read itself.
enum SchemaContent {}
impl lsp::request::Request for SchemaContent {
    type Params = Vec<String>;
    type Result = String;
    const METHOD: &'static str = "vscode/content";
}
/// `html/customDataContent`: the HTML server asks its editor for the text of every custom
/// data file it was told of; it reads none itself.
enum HtmlCustomDataContent {}
impl lsp::request::Request for HtmlCustomDataContent {
    type Params = Vec<String>;
    type Result = String;
    const METHOD: &'static str = "html/customDataContent";
}
const SHUTDOWN_LIMIT: Duration = Duration::from_secs(3);

/// The requests Setdown may send to a server Zed runs. They cross unchanged in both
/// directions, so the editor keeps receiving the protocol's own shapes.
macro_rules! raw_requests {
    ($($name:ident = $method:literal),* $(,)?) => {
        $(
            enum $name {}
            impl lsp::request::Request for $name {
                type Params = Value;
                type Result = Value;
                const METHOD: &'static str = $method;
            }
        )*
        fn raw_request(
            server: &Arc<LanguageServer>,
            method: &str,
            params: Value,
        ) -> Option<Pin<Box<dyn Future<Output = util::ConnectionResult<Value>>>>> {
            match method {
                $($method => Some(Box::pin(server.request::<$name>(params, REQUEST_TIMEOUT))),)*
                _ => None,
            }
        }
    };
}
raw_requests!(
    Completion = "textDocument/completion", CompletionResolve = "completionItem/resolve",
    Hover = "textDocument/hover", SignatureHelp = "textDocument/signatureHelp",
    Definition = "textDocument/definition", References = "textDocument/references",
    DocumentSymbol = "textDocument/documentSymbol", Rename = "textDocument/rename",
    PrepareRename = "textDocument/prepareRename", Declaration = "textDocument/declaration",
    TypeDefinition = "textDocument/typeDefinition", Implementation = "textDocument/implementation",
    DocumentHighlight = "textDocument/documentHighlight", SelectionRange = "textDocument/selectionRange",
    FoldingRange = "textDocument/foldingRange", DocumentLink = "textDocument/documentLink",
    DocumentLinkResolve = "documentLink/resolve", DocumentColor = "textDocument/documentColor",
    ColorPresentation = "textDocument/colorPresentation",
    SemanticTokensFull = "textDocument/semanticTokens/full",
    SemanticTokensDelta = "textDocument/semanticTokens/full/delta",
    SemanticTokensRange = "textDocument/semanticTokens/range",
    InlayHint = "textDocument/inlayHint", InlayHintResolve = "inlayHint/resolve",
    LinkedEditingRange = "textDocument/linkedEditingRange", CodeAction = "textDocument/codeAction",
    CodeActionResolve = "codeAction/resolve", CodeLens = "textDocument/codeLens",
    CodeLensResolve = "codeLens/resolve", Formatting = "textDocument/formatting",
    RangeFormatting = "textDocument/rangeFormatting", OnTypeFormatting = "textDocument/onTypeFormatting",
    WillSaveWaitUntil = "textDocument/willSaveWaitUntil", WorkspaceSymbol = "workspace/symbol",
    WorkspaceSymbolResolve = "workspaceSymbol/resolve", ExecuteCommand = "workspace/executeCommand",
    PrepareCallHierarchy = "textDocument/prepareCallHierarchy",
    IncomingCalls = "callHierarchy/incomingCalls", OutgoingCalls = "callHierarchy/outgoingCalls",
    PrepareTypeHierarchy = "textDocument/prepareTypeHierarchy",
    Supertypes = "typeHierarchy/supertypes", Subtypes = "typeHierarchy/subtypes",
    WillCreateFiles = "workspace/willCreateFiles", WillRenameFiles = "workspace/willRenameFiles",
    WillDeleteFiles = "workspace/willDeleteFiles",
    // Outside the protocol: what one tool's own editor extension asks it. Setdown sends each
    // only to the tool it belongs to (`apps/desktop/src/main/language/extension-rules.ts`).
    HtmlAutoInsert = "html/autoInsert", HtmlTag = "html/tag",
    SwitchSourceHeader = "textDocument/switchSourceHeader",
    JsonLanguageStatus = "json/languageStatus", JsonSort = "json/sort",
    HtmlSemanticTokenLegend = "html/semanticTokenLegend", HtmlSemanticTokens = "html/semanticTokens",
    YamlFileSchemas = "yaml/get/jsonSchema", YamlAllSchemas = "yaml/get/all/jsonSchemas",
);

/// What a server tells only its own editor extension. Setdown shows each as that extension
/// does (`apps/desktop/src/main/language/tool-signals.ts`), so they cross unchanged.
macro_rules! forwarded_notifications {
    ($($name:ident = $method:literal),* $(,)?) => {
        $(
            enum $name {}
            impl lsp::notification::Notification for $name {
                type Params = Value;
                const METHOD: &'static str = $method;
            }
        )*
        fn forward_notifications(workspace: &str, server: &Arc<LanguageServer>) {
            $({
                let workspace = workspace.to_string();
                let id = server.server_id().0;
                server
                    .on_notification::<$name, _>(move |params, _| {
                        emit(json!({"event": "project.toolNotification", "workspace": workspace, "server": id, "method": $method, "params": params}));
                    })
                    .detach();
            })*
        }
    };
}
forwarded_notifications!(
    YamlSchemaStoreInitialized = "yaml/schema/store/initialized",
    YamlResultLimitReached = "yaml/resultLimitReached",
);

/// What Setdown tells a server itself: a save it is about to make, and the files it created,
/// renamed and deleted. Zed announces only the file operations made through its own project.
macro_rules! raw_notifications {
    ($($name:ident = $method:literal),* $(,)?) => {
        $(
            enum $name {}
            impl lsp::notification::Notification for $name {
                type Params = Value;
                const METHOD: &'static str = $method;
            }
        )*
        fn raw_notification(server: &Arc<LanguageServer>, method: &str, params: Value) -> Result<()> {
            match method {
                $($method => server.notify::<$name>(params),)*
                _ => bail!("Unsupported notification {method}"),
            }
        }
    };
}
raw_notifications!(
    WillSave = "textDocument/willSave", DidCreateFiles = "workspace/didCreateFiles",
    DidRenameFiles = "workspace/didRenameFiles", DidDeleteFiles = "workspace/didDeleteFiles",
    // The Svelte server reads TypeScript and JavaScript files from disk unless told of a change.
    SvelteScriptChanged = "$/onDidChangeTsOrJsFile",
    // The custom data files of the project, and the YAML extension's "send me the schema store event".
    CssCustomDataChanged = "css/customDataChanged", HtmlCustomDataChanged = "html/customDataChanged",
    YamlSupportSchemaSelection = "yaml/supportSchemaSelection",
);

struct Document {
    buffer: Entity<Buffer>,
    /// Setdown's own number for the text this copy holds.
    revision: i64,
    /// The copy's version after the last change Setdown sent. Any other version means
    /// something here changed the copy (a reload from disk, an edit made by Zed).
    expected: clock::Global,
    _servers: OpenLspBufferHandle,
    _events: Subscription,
    /// The diagnostics request that is waiting or running for the current text.
    pull: Task<()>,
}

/// One Setdown window. Two windows may hold different unsaved text for the same file,
/// so each has its own project and its own servers.
struct Workspace {
    project: Entity<Project>,
    documents: HashMap<PathBuf, Document>,
    _events: Subscription,
}

pub struct ProjectHost {
    client: Arc<Client>,
    user_store: Entity<UserStore>,
    node: NodeRuntime,
    languages: Arc<LanguageRegistry>,
    fs: Arc<dyn Fs>,
    workspaces: HashMap<String, Workspace>,
    requests: HashMap<u64, Task<()>>,
    edits: HashMap<u64, oneshot::Sender<(bool, Option<String>)>>,
    next_edit: u64,
    /// Schemas Setdown was asked to download: the text, or the refusal's code and message.
    schemas: HashMap<u64, oneshot::Sender<std::result::Result<String, (i64, String)>>>,
    next_schema: u64,
}

/// Zed reports how it is used to its makers. This process is not Zed in a person's hands,
/// so the lowest settings layer, which Setdown's own defaults replace, always says not to.
pub fn shipped_settings(mut defaults: Value) -> String {
    defaults["telemetry"] = json!({"diagnostics": false, "metrics": false});
    defaults.to_string()
}

fn text<'a>(request: &'a Value, key: &str) -> Result<&'a str> {
    request[key].as_str().with_context(|| format!("Missing `{key}`"))
}
fn absolute(request: &Value, key: &str) -> Result<PathBuf> {
    let path = PathBuf::from(text(request, key)?);
    ensure!(path.is_absolute(), "`{key}` must be an absolute path");
    Ok(path)
}
fn position(point: PointUtf16) -> Value {
    json!({"line": point.row, "character": point.column})
}
fn progress_token(token: Option<&proto::ProgressToken>) -> Value {
    match token.and_then(|token| token.value.as_ref()) {
        Some(proto::progress_token::Value::Number(number)) => json!(number),
        Some(proto::progress_token::Value::String(text)) => json!(text),
        None => Value::Null,
    }
}

impl ProjectHost {
    pub fn new(
        client: Arc<Client>,
        node: NodeRuntime,
        languages: Arc<LanguageRegistry>,
        fs: Arc<dyn Fs>,
        cx: &mut App,
    ) -> Entity<Self> {
        let user_store = cx.new(|cx| UserStore::new(client.clone(), cx));
        cx.new(|_| Self {
            client,
            user_store,
            node,
            languages,
            fs,
            workspaces: HashMap::default(),
            requests: HashMap::default(),
            edits: HashMap::default(),
            next_edit: 0,
            schemas: HashMap::default(),
            next_schema: 0,
        })
    }

    fn workspace(&mut self, name: &str, cx: &mut Context<Self>) -> Entity<Project> {
        if let Some(workspace) = self.workspaces.get(name) {
            return workspace.project.clone();
        }
        // Setdown opens a file because a person asked for it, which is the consent Zed's
        // worktree trust asks for. Zed's own user settings are not this process's settings.
        let flags = LocalProjectFlags { init_worktree_trust: false, watch_global_configs: false };
        let project = Project::local(
            self.client.clone(),
            self.node.clone(),
            self.user_store.clone(),
            self.languages.clone(),
            self.fs.clone(),
            None,
            flags,
            cx,
        );
        let lsp_store = project.read(cx).lsp_store();
        let events = cx.subscribe(&lsp_store, {
            let name = name.to_string();
            move |this, lsp_store, event, cx| this.server_event(&name, &lsp_store, event, cx)
        });
        self.workspaces.insert(
            name.to_string(),
            Workspace { project: project.clone(), documents: HashMap::default(), _events: events },
        );
        project
    }

    fn server_event(
        &mut self,
        workspace: &str,
        lsp_store: &Entity<project::LspStore>,
        event: &LspStoreEvent,
        cx: &mut Context<Self>,
    ) {
        match event {
            LspStoreEvent::LanguageServerAdded(id, name, _) => {
                if let Some(server) = lsp_store.read(cx).language_server_for_id(*id) {
                    self.own_server_edits(workspace, &server, cx);
                    self.own_schema_downloads(workspace, lsp_store, &server, cx);
                    self.own_custom_data(workspace, &server, cx);
                    forward_notifications(workspace, &server);
                }
                emit(json!({"event": "project.server", "workspace": workspace, "state": "added", "server": id.0, "name": name.0}));
            }
            LspStoreEvent::LanguageServerRemoved(id) => {
                emit(json!({"event": "project.server", "workspace": workspace, "state": "removed", "server": id.0}));
            }
            LspStoreEvent::LanguageServerUpdate { language_server_id, name, message } => {
                let server = language_server_id.0;
                let name = name.as_ref().map(|name| name.0.to_string());
                match message {
                    // A status of the program (being downloaded, failed to start) has no server yet;
                    // it is known by the server's name.
                    Variant::StatusUpdate(update) => {
                        let status = match update.status {
                            Some(proto::status_update::Status::Binary(status)) => match proto::ServerBinaryStatus::try_from(status) {
                                Ok(proto::ServerBinaryStatus::CheckingForUpdate) => "checking",
                                Ok(proto::ServerBinaryStatus::Downloading) => "downloading",
                                Ok(proto::ServerBinaryStatus::Starting) => "starting",
                                Ok(proto::ServerBinaryStatus::Stopping) => "stopping",
                                Ok(proto::ServerBinaryStatus::Stopped) => "stopped",
                                Ok(proto::ServerBinaryStatus::Failed) => "failed",
                                _ => "none",
                            },
                            Some(proto::status_update::Status::Health(health)) => match proto::ServerHealth::try_from(health) {
                                Ok(proto::ServerHealth::Warning) => "warning",
                                Ok(proto::ServerHealth::Error) => "error",
                                _ => "ok",
                            },
                            None => "none",
                        };
                        emit(json!({"event": "project.status", "workspace": workspace, "name": name, "status": status, "message": update.message}));
                        if matches!(update.status, Some(proto::status_update::Status::Health(_))) {
                            self.pull_open_documents(workspace, cx);
                        }
                    }
                    Variant::RegisteredForBuffer(registered) => {
                        emit(json!({"event": "project.registered", "workspace": workspace, "server": server, "path": registered.buffer_abs_path}));
                        self.pull_diagnostics(workspace, &PathBuf::from(&registered.buffer_abs_path), cx);
                    }
                    Variant::MetadataUpdated(_) => {
                        emit(json!({"event": "project.capabilities", "workspace": workspace, "server": server}));
                    }
                    Variant::WorkStart(work) => {
                        emit(json!({"event": "project.progress", "workspace": workspace, "server": server, "phase": "start",
                            "token": progress_token(work.token.as_ref()), "title": work.title, "message": work.message, "percentage": work.percentage}));
                    }
                    Variant::WorkProgress(work) => {
                        emit(json!({"event": "project.progress", "workspace": workspace, "server": server, "phase": "report",
                            "token": progress_token(work.token.as_ref()), "message": work.message, "percentage": work.percentage}));
                    }
                    Variant::WorkEnd(work) => {
                        emit(json!({"event": "project.progress", "workspace": workspace, "server": server, "phase": "end",
                            "token": progress_token(work.token.as_ref())}));
                        self.pull_open_documents(workspace, cx);
                    }
                    _ => {}
                }
            }
            LspStoreEvent::RefreshInlayHints { server_id } => {
                emit(json!({"event": "project.refresh", "workspace": workspace, "server": server_id.0, "feature": "inlayHint"}));
            }
            LspStoreEvent::RefreshSemanticTokens { server_id } => {
                emit(json!({"event": "project.refresh", "workspace": workspace, "server": server_id.0, "feature": "semanticTokens"}));
            }
            LspStoreEvent::RefreshCodeLens { server_id } => {
                emit(json!({"event": "project.refresh", "workspace": workspace, "server": server_id.map(|id| id.0), "feature": "codeLens"}));
            }
            LspStoreEvent::Notification(message) => {
                emit(json!({"event": "project.message", "workspace": workspace, "message": message}));
            }
            _ => {}
        }
    }

    /// Zed answers `workspace/applyEdit` by editing its buffers and creating, renaming and
    /// deleting files. Here that would change an analysis copy and the disk behind the
    /// editor's back, so the request goes to Setdown, which applies it to its own documents
    /// (with their versions checked and Undo kept) and reports the outcome.
    fn own_server_edits(&mut self, workspace: &str, server: &Arc<LanguageServer>, cx: &mut Context<Self>) {
        let this = cx.weak_entity();
        let workspace = workspace.to_string();
        let server_id = server.server_id().0;
        server.remove_request_handler::<lsp::request::ApplyWorkspaceEdit>();
        server
            .on_request::<lsp::request::ApplyWorkspaceEdit, _, _>(move |params, cx| {
                let this = this.clone();
                let workspace = workspace.clone();
                let mut cx = cx.clone();
                async move {
                    let (edit, answer) = this.update(&mut cx, |this, _| {
                        let (send, receive) = oneshot::channel();
                        this.next_edit += 1;
                        this.edits.insert(this.next_edit, send);
                        (this.next_edit, receive)
                    })?;
                    emit(json!({"event": "project.applyEdit", "workspace": workspace, "server": server_id,
                        "edit": edit, "label": params.label, "workspaceEdit": params.edit}));
                    let mut timeout = cx.background_executor().timer(EDIT_ANSWER_TIMEOUT).fuse();
                    let mut answer = answer.fuse();
                    let (applied, failure_reason) = futures::select_biased! {
                        answer = answer => answer.unwrap_or((false, Some("The editor closed before applying the edit.".into()))),
                        _ = timeout => (false, Some("The editor did not apply the edit in time.".into())),
                    };
                    this.update(&mut cx, |this, _| this.edits.remove(&edit)).ok();
                    Ok(lsp::ApplyWorkspaceEditResponse { applied, failure_reason, failed_change: None })
                }
            })
            .detach();
    }

    /// The HTML server reads no custom data file itself: it asks its editor for the text of each
    /// (`html/customDataContent`). Setdown reads the file and answers, or refuses, on the channel
    /// the JSON server's schema requests use.
    fn own_custom_data(&mut self, workspace: &str, server: &Arc<LanguageServer>, cx: &mut Context<Self>) {
        let this = cx.weak_entity();
        let workspace = workspace.to_string();
        let server_id = server.server_id().0;
        server
            .on_request::<HtmlCustomDataContent, _, _>(move |mut params, cx| {
                let this = this.clone();
                let workspace = workspace.clone();
                let mut cx = cx.clone();
                async move {
                    let uri = params.pop().context("No URI")?;
                    let (request, answer) = this.update(&mut cx, |this, _| {
                        let (send, receive) = oneshot::channel();
                        this.next_schema += 1;
                        this.schemas.insert(this.next_schema, send);
                        (this.next_schema, receive)
                    })?;
                    emit(json!({"event": "project.schemaContent", "kind": "html.customData", "workspace": workspace, "server": server_id, "request": request, "uri": uri}));
                    let mut timeout = cx.background_executor().timer(SCHEMA_ANSWER_TIMEOUT).fuse();
                    let mut answer = answer.fuse();
                    let answer = futures::select_biased! {
                        answer = answer => answer.unwrap_or_else(|_| Err((SCHEMA_REQUEST_FAILED, "The editor closed before answering.".into()))),
                        _ = timeout => Err((SCHEMA_REQUEST_FAILED, "The editor did not answer in time.".into())),
                    };
                    this.update(&mut cx, |this, _| this.schemas.remove(&request)).ok();
                    answer.map_err(|(code, message)| anyhow::Error::new(lsp::ResponseError { code: code.into(), message, data: None }))
                }
            })
            .detach();
    }

    /// Zed answers `vscode/content` for its own `zed://` schemas, and its JSON server downloads
    /// every other schema by itself. VS Code's JSON extension has the editor download them, so
    /// that an address is checked against the trusted domains and the schema is kept on disk.
    /// Setdown starts the server the way that extension does (`handledSchemaProtocols`), so an
    /// http(s) address arrives here and goes on to Setdown, which answers as that extension would.
    fn own_schema_downloads(&mut self, workspace: &str, lsp_store: &Entity<project::LspStore>, server: &Arc<LanguageServer>, cx: &mut Context<Self>) {
        let this = cx.weak_entity();
        let lsp_store = lsp_store.downgrade();
        let workspace = workspace.to_string();
        let server_id = server.server_id().0;
        server.remove_request_handler::<SchemaContent>();
        server
            .on_request::<SchemaContent, _, _>(move |mut params, cx| {
                let this = this.clone();
                let lsp_store = lsp_store.clone();
                let workspace = workspace.clone();
                let mut cx = cx.clone();
                async move {
                    let uri = params.pop().context("No URI")?;
                    if !(uri.starts_with("http://") || uri.starts_with("https://")) {
                        let lsp_store = lsp_store.upgrade().context("LSP store has been dropped")?;
                        return json_schema_store::handle_schema_request(lsp_store, uri, &mut cx).await;
                    }
                    let (request, answer) = this.update(&mut cx, |this, _| {
                        let (send, receive) = oneshot::channel();
                        this.next_schema += 1;
                        this.schemas.insert(this.next_schema, send);
                        (this.next_schema, receive)
                    })?;
                    emit(json!({"event": "project.schemaContent", "workspace": workspace, "server": server_id, "request": request, "uri": uri}));
                    let mut timeout = cx.background_executor().timer(SCHEMA_ANSWER_TIMEOUT).fuse();
                    let mut answer = answer.fuse();
                    let answer = futures::select_biased! {
                        answer = answer => answer.unwrap_or_else(|_| Err((SCHEMA_REQUEST_FAILED, "The editor closed before answering.".into()))),
                        _ = timeout => Err((SCHEMA_REQUEST_FAILED, "The editor did not answer in time.".into())),
                    };
                    this.update(&mut cx, |this, _| this.schemas.remove(&request)).ok();
                    // The server reads the refusal's code: it tells an untrusted address from a failed download.
                    answer.map_err(|(code, message)| anyhow::Error::new(lsp::ResponseError { code: code.into(), message, data: None }))
                }
            })
            .detach();
    }

    fn document_event(&mut self, workspace: &str, path: &PathBuf, event: &BufferEvent, cx: &mut Context<Self>) {
        match event {
            BufferEvent::DiagnosticsUpdated => self.publish_diagnostics(workspace, path, false, cx),
            BufferEvent::Edited { .. } | BufferEvent::Reloaded => {
                let Some(document) = self.workspaces.get(workspace).and_then(|w| w.documents.get(path)) else { return };
                if document.buffer.read(cx).version() != document.expected {
                    emit(json!({"event": "project.diverged", "workspace": workspace, "path": path, "revision": document.revision}));
                }
            }
            _ => {}
        }
    }

    /// Diagnostics are read from Zed's store, not from the server's notification: Zed has
    /// already matched them to the document version they were computed for and moved them
    /// through the edits made since, so their positions are positions in the current copy.
    fn publish_diagnostics(&self, workspace: &str, path: &PathBuf, only_pulled: bool, cx: &mut Context<Self>) {
        let Some(state) = self.workspaces.get(workspace) else { return };
        let Some(document) = state.documents.get(path) else { return };
        let lsp_store = state.project.read(cx).lsp_store();
        let servers = lsp_store.update(cx, |store, cx| {
            document.buffer.update(cx, |buffer, cx| store.language_servers_for_local_buffer(buffer, cx))
        });
        let buffer = document.buffer.read(cx);
        let snapshot = buffer.snapshot();
        let synced = buffer.version() == document.expected;
        let uri = lsp::Uri::from_file_path(path).ok();
        for server in servers {
            if only_pulled && !lsp_store.read(cx).language_server_for_id(server)
                .is_some_and(|server| server.capabilities().diagnostic_provider.is_some()) {
                continue;
            }
            let range = |range: &std::ops::Range<language::Anchor>| {
                json!({"start": position(range.start.to_point_utf16(&snapshot)), "end": position(range.end.to_point_utf16(&snapshot))})
            };
            let diagnostics = buffer.buffer_diagnostics(Some(server)).into_iter()
                .filter(|entry| entry.diagnostic.is_primary)
                .map(|entry: &DiagnosticEntry<language::Anchor>| {
                    let diagnostic = &entry.diagnostic;
                    let related = entry.related_information.iter().flat_map(|all| all.iter()).filter_map(|related| {
                        let location = match &related.location {
                            RelatedLocation::InBuffer(span) => json!({"uri": uri.as_ref()?, "range": range(span)}),
                            RelatedLocation::InAnotherFile(location) => json!(location),
                        };
                        Some(json!({"location": location, "message": related.message}))
                    }).collect::<Vec<_>>();
                    let mut value = json!({"range": range(&entry.range), "severity": diagnostic.severity,
                        "message": diagnostic.message.as_str()});
                    let fields = value.as_object_mut().expect("object");
                    if let Some(source) = &diagnostic.source { fields.insert("source".into(), json!(source)); }
                    if let Some(code) = &diagnostic.code { fields.insert("code".into(), json!(code)); }
                    if let Some(href) = &diagnostic.code_description { fields.insert("codeDescription".into(), json!({"href": href})); }
                    if diagnostic.is_unnecessary { fields.insert("tags".into(), json!([1])); }
                    if let Some(data) = &diagnostic.data { fields.insert("data".into(), data.clone()); }
                    if !related.is_empty() { fields.insert("relatedInformation".into(), json!(related)); }
                    value
                }).collect::<Vec<_>>();
            emit(json!({"event": "project.diagnostics", "workspace": workspace, "path": path, "server": server.0,
                "revision": document.revision, "synced": synced, "diagnostics": diagnostics}));
        }
    }

    /// Servers that answer diagnostics only when asked are asked by Zed's editor view
    /// (`editor::Editor::pull_diagnostics`), which this process does not have. The same
    /// request is made here at the same moments: when a file gains a server and after its
    /// text changed, after the delay Zed's settings give. A server that answers "unchanged"
    /// changes nothing in Zed's store, so what the store holds is announced again: the editor
    /// forgot its marks when the text changed.
    fn pull_diagnostics(&mut self, workspace: &str, path: &PathBuf, cx: &mut Context<Self>) {
        let settings = ProjectSettings::get_global(cx).diagnostics.lsp_pull_diagnostics;
        if !settings.enabled {
            return;
        }
        let Some(state) = self.workspaces.get_mut(workspace) else { return };
        let lsp_store = state.project.read(cx).lsp_store().downgrade();
        let Some(document) = state.documents.get_mut(path) else { return };
        let buffer = document.buffer.clone();
        let buffer_id = buffer.read(cx).remote_id();
        let (workspace, path) = (workspace.to_string(), path.clone());
        document.pull = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(settings.debounce_ms)).await;
            if let Ok(pulled) = lsp_store.update(cx, |store, cx| store.pull_diagnostics_for_buffer(buffer, cx)) {
                if let Err(error) = pulled.await {
                    eprintln!("Diagnostics request failed: {error:#}");
                }
            }
            lsp_store.update(cx, |store, cx| store.pull_document_diagnostics_for_buffer_edit(buffer_id, cx)).ok();
            this.update(cx, |this, cx| this.publish_diagnostics(&workspace, &path, true, cx)).ok();
        });
    }

    /// A server that is still reading the project answers a diagnostics request with nothing
    /// (rust-analyzer does while it loads a workspace), and it does not always ask to be asked
    /// again once it has finished. So the request is repeated when a server ends a piece of
    /// work or reports its health.
    fn pull_open_documents(&mut self, workspace: &str, cx: &mut Context<Self>) {
        let Some(state) = self.workspaces.get(workspace) else { return };
        for path in state.documents.keys().cloned().collect::<Vec<_>>() {
            self.pull_diagnostics(workspace, &path, cx);
        }
    }

    fn servers(&self, workspace: &str, path: &PathBuf, cx: &mut Context<Self>) -> Result<Value> {
        let state = self.workspaces.get(workspace).context("Unknown workspace")?;
        let document = state.documents.get(path).context("Document is not open")?;
        let lsp_store = state.project.read(cx).lsp_store();
        Ok(lsp_store.update(cx, |store, cx| document.buffer.update(cx, |buffer, cx| {
            let language = buffer.language().map(|language| language.name().to_string());
            let servers = store.running_language_servers_for_local_buffer(buffer, cx).map(|(adapter, server)| {
                json!({"server": server.server_id().0, "name": adapter.name().0, "capabilities": server.capabilities(),
                    "folders": server.workspace_folders(), "binary": server.binary().path})
            }).collect::<Vec<_>>();
            json!({"language": language, "servers": servers})
        })))
    }

    fn change(&mut self, request: &Value, cx: &mut Context<Self>) -> Result<Value> {
        let path = absolute(request, "path")?;
        let revision = request["revision"].as_i64().context("Missing `revision`")?;
        let document = self.workspaces.get_mut(text(request, "workspace")?).context("Unknown workspace")?
            .documents.get_mut(&path).context("Document is not open")?;
        let length = document.buffer.update(cx, |buffer, cx| -> Result<usize> {
            buffer.start_transaction();
            let result = (|| -> Result<()> {
                if let Some(text) = request["text"].as_str() {
                    buffer.set_text(text, cx);
                    return Ok(());
                }
                // As in the protocol, each change applies to the result of the one before it.
                for change in request["changes"].as_array().context("Missing `changes`")? {
                    let text = text(change, "text")?;
                    if change["range"].is_null() {
                        buffer.set_text(text, cx);
                        continue;
                    }
                    let point = |value: &Value| -> Result<PointUtf16> {
                        let line = value["line"].as_u64().context("Invalid position")?;
                        let character = value["character"].as_u64().context("Invalid position")?;
                        Ok(buffer.clip_point_utf16(Unclipped(PointUtf16::new(line as u32, character as u32)), Bias::Left))
                    };
                    let (start, end) = (point(&change["range"]["start"])?, point(&change["range"]["end"])?);
                    buffer.edit([(start..end, text)], None, cx);
                }
                Ok(())
            })();
            // The copy keeps no Undo history: Setdown's document owns it.
            if let Some(transaction) = buffer.end_transaction(cx) {
                buffer.forget_transaction(transaction);
            }
            result?;
            Ok(buffer.text_summary().len_utf16.0)
        });
        document.expected = document.buffer.read(cx).version();
        document.revision = revision;
        let length = length?;
        // A cheap check that both sides hold the same text; a mismatch is answered with the whole text.
        if let Some(expected) = request["length"].as_u64() {
            ensure!(expected as usize == length, "Document copy differs from the editor ({length} != {expected} UTF-16 units)");
        }
        Ok(json!({"revision": revision, "length": length}))
    }

    /// Setdown wrote the file. Marking the copy as saved makes Zed send `didSave`, which
    /// several servers wait for before they check a project, without writing anything here.
    fn saved(&mut self, request: &Value, mtime: Option<fs::MTime>, cx: &mut Context<Self>) -> Result<Value> {
        let path = absolute(request, "path")?;
        let document = self.workspaces.get_mut(text(request, "workspace")?).context("Unknown workspace")?
            .documents.get_mut(&path).context("Document is not open")?;
        // A newer revision is already here: the text on disk is not the text of this copy.
        let current = request["revision"].as_i64() == Some(document.revision);
        if current {
            document.buffer.update(cx, |buffer, cx| buffer.did_save(buffer.version(), mtime, cx));
            document.expected = document.buffer.read(cx).version();
        }
        Ok(json!({"saved": current}))
    }

    fn close(&mut self, request: &Value) -> Result<Value> {
        let path = absolute(request, "path")?;
        let closed = self.workspaces.get_mut(text(request, "workspace")?)
            .and_then(|workspace| workspace.documents.remove(&path)).is_some();
        Ok(json!({"closed": closed}))
    }

    fn request(&mut self, id: u64, request: &Value, cx: &mut Context<Self>) -> Result<()> {
        let state = self.workspaces.get(text(request, "workspace")?).context("Unknown workspace")?;
        let server = LanguageServerId(request["server"].as_u64().context("Missing `server`")? as usize);
        let server = state.project.read(cx).lsp_store().read(cx).language_server_for_id(server)
            .context("The language server is not running")?;
        let method = text(request, "method")?;
        let response = raw_request(&server, method, request["params"].clone())
            .with_context(|| format!("Unsupported method {method}"))?;
        let task = cx.spawn(async move |this, cx| {
            emit(match response.await.into_response() {
                Ok(value) => json!({"id": id, "result": value}),
                // The server's own refusal keeps its code: the editor asks again after "content
                // modified" and "server cancelled", and stays silent about others.
                Err(error) => match error.downcast_ref::<lsp::ResponseError>() {
                    Some(refusal) => json!({"id": id, "error": refusal.message, "code": i64::from(refusal.code.clone()), "data": refusal.data}),
                    None => json!({"id": id, "error": format!("{error:#}")}),
                },
            });
            this.update(cx, |this, _| this.requests.remove(&id)).ok();
        });
        self.requests.insert(id, task);
        Ok(())
    }

    async fn open(this: &WeakEntity<Self>, request: &Value, cx: &mut AsyncApp) -> Result<Value> {
        let workspace = text(request, "workspace")?.to_string();
        let path = absolute(request, "path")?;
        let content = text(request, "text")?.to_string();
        let revision = request["revision"].as_i64().context("Missing `revision`")?;
        let project = this.update(cx, |this, cx| this.workspace(&workspace, cx))?;
        // Inside an open folder this is that folder's worktree; a file opened on its own
        // becomes a single-file worktree, as it does in Zed.
        let (worktree, relative) = project.update(cx, |project, cx| project.find_or_create_worktree(&path, true, cx)).await?;
        let project_path = ProjectPath { worktree_id: worktree.read_with(cx, |worktree, _| worktree.id()), path: relative };
        let buffer = project.update(cx, |project, cx| project.open_buffer(project_path.clone(), cx)).await?;
        let languages = this.read_with(cx, |this, _| this.languages.clone())?;
        // The document's language is Setdown's: the person sees it, can change it, and it chose
        // the tool. Where Zed found none for the file (`.webmanifest` is JSON) or another
        // (`jsconfig.json` allows comments), it is set the way a person picks a file's
        // language in Zed.
        let named = match request["language"].as_str() { Some(name) => languages.language_for_name(name).await.ok(), None => None };
        if let Some(named) = &named && buffer.read_with(cx, |buffer, _| buffer.language().is_none_or(|found| found.name() != named.name())) {
            project.update(cx, |project, cx| project.set_language_for_buffer(&buffer, named.clone(), cx));
        }
        let language = match named { Some(named) => Some(named), None => languages.load_language_for_file_path(&path).await.ok() };
        if let Some(language) = language {
            Self::choose_toolchain(&project, project_path.clone(), language.name(), cx).await;
        }
        this.update(cx, |this, cx| -> Result<Value> {
            let state = this.workspaces.get(&workspace).context("Unknown workspace")?;
            ensure!(!state.documents.contains_key(&path), "Document is already open");
            buffer.update(cx, |buffer, cx| {
                if buffer.text() != content {
                    buffer.start_transaction();
                    buffer.set_text(content.as_str(), cx);
                    if let Some(transaction) = buffer.end_transaction(cx) {
                        buffer.forget_transaction(transaction);
                    }
                }
            });
            let servers = state.project.update(cx, |project, cx| project.register_buffer_with_language_servers(&buffer, cx));
            let events = cx.subscribe(&buffer, {
                let (workspace, path) = (workspace.clone(), path.clone());
                move |this, _, event, cx| this.document_event(&workspace, &path, event, cx)
            });
            let expected = buffer.read(cx).version();
            let language = buffer.read(cx).language().map(|language| language.name());
            let configured = language.as_ref().map(|language| this.configured_servers(language, &project_path, cx)).unwrap_or_default();
            let state = this.workspaces.get_mut(&workspace).context("Unknown workspace")?;
            state.documents.insert(path.clone(), Document { buffer, revision, expected, _servers: servers, _events: events, pull: Task::ready(()) });
            this.pull_diagnostics(&workspace, &path, cx);
            Ok(json!({"language": language.map(|language| language.to_string()), "servers": configured}))
        })?
    }

    /// The servers the settings give this file, in their order, whether or not they run yet.
    /// The same reading as Zed's own (`project::manifest_tree::ServerTree::adapters_for_language`).
    fn configured_servers(&self, language: &language::LanguageName, path: &ProjectPath, cx: &App) -> Vec<String> {
        let location = SettingsLocation { worktree_id: path.worktree_id, path: &path.path };
        let settings = AllLanguageSettings::get(Some(location), cx).language(Some(location), Some(language), cx);
        if !settings.enable_language_server {
            return Vec::new();
        }
        let available = self.languages.lsp_adapters(language).iter()
            .filter(|adapter| !adapter.is_opt_in_for(language))
            .map(|adapter| adapter.name.clone()).collect::<Vec<_>>();
        settings.customized_language_servers(&available).into_iter().map(|name| name.0.to_string()).collect()
    }

    fn restart(&mut self, request: &Value, cx: &mut Context<Self>) -> Result<Value> {
        let state = self.workspaces.get(text(request, "workspace")?).context("Unknown workspace")?;
        let buffers = match request["path"].as_str() {
            Some(_) => vec![state.documents.get(&absolute(request, "path")?).context("Document is not open")?.buffer.clone()],
            None => state.documents.values().map(|document| document.buffer.clone()).collect(),
        };
        let only = request["names"].as_array().into_iter().flatten().filter_map(|name| name.as_str())
            .map(|name| lsp::LanguageServerSelector::Name(lsp::LanguageServerName::from(name))).collect();
        let restarted = buffers.len();
        state.project.update(cx, |project, cx| project.restart_language_servers_for_buffers(buffers, only, cx));
        Ok(json!({"restarted": restarted}))
    }

    /// A closed window. Its servers are asked to shut down, and the answer waits for them
    /// (not for long: Setdown ends this process next when it is quitting).
    fn dispose(&mut self, id: u64, request: &Value, cx: &mut Context<Self>) -> Result<()> {
        let Some(state) = self.workspaces.remove(text(request, "workspace")?) else {
            emit(json!({"id": id, "result": {"disposed": false}}));
            return Ok(());
        };
        let Workspace { project, documents, _events } = state;
        drop(documents);
        let stopped = project.read(cx).lsp_store().update(cx, |store, cx| store.shutdown_all_language_servers(cx));
        cx.spawn(async move |_, cx| {
            let mut limit = cx.background_executor().timer(SHUTDOWN_LIMIT).fuse();
            futures::select_biased! { _ = stopped.fuse() => {}, _ = limit => {} }
            drop(project);
            emit(json!({"id": id, "result": {"disposed": true}}));
        }).detach();
        Ok(())
    }

    fn notify(&mut self, request: &Value, cx: &mut Context<Self>) -> Result<Value> {
        let state = self.workspaces.get(text(request, "workspace")?).context("Unknown workspace")?;
        let server = LanguageServerId(request["server"].as_u64().context("Missing `server`")? as usize);
        let server = state.project.read(cx).lsp_store().read(cx).language_server_for_id(server)
            .context("The language server is not running")?;
        raw_notification(&server, text(request, "method")?, request["params"].clone())?;
        Ok(json!({}))
    }

    /// Zed's toolchain store only holds what was chosen; choosing the first detected
    /// toolchain when nothing is chosen is done by Zed's status bar item
    /// (`toolchain_selector::ActiveToolchain`), which this process does not have. Done
    /// before the servers start, so that they start in that environment.
    async fn choose_toolchain(project: &Entity<Project>, path: ProjectPath, language: language::LanguageName, cx: &mut AsyncApp) {
        if project.read_with(cx, |project, cx| project.active_toolchain(path.clone(), language.clone(), cx)).await.is_some() {
            return;
        }
        let Some(available) = project.read_with(cx, |project, cx| project.available_toolchains(path.clone(), language, cx)).await else { return };
        let Some(toolchain) = available.toolchains.toolchains.first().cloned() else { return };
        let root = ProjectPath { worktree_id: path.worktree_id, path: available.root_path };
        project.update(cx, |project, cx| project.activate_toolchain(root, toolchain, cx)).await;
    }

    /// Handles one `project.*` message. Messages that change a document are applied in the
    /// order they arrive; a server request only starts in that order and answers when it is done.
    pub async fn handle(this: &Entity<Self>, id: u64, request: Value, cx: &mut AsyncApp) {
        let weak = this.downgrade();
        let result: Result<Option<Value>> = async {
            Ok(Some(match text(&request, "op")? {
                "project.folder" => {
                    let root = absolute(&request, "root")?;
                    let workspace = text(&request, "workspace")?;
                    let project = this.update(cx, |this, cx| this.workspace(workspace, cx));
                    let (worktree, _) = project.update(cx, |project, cx| project.find_or_create_worktree(&root, true, cx)).await?;
                    json!({"worktree": worktree.read_with(cx, |worktree, _| worktree.id().to_usize())})
                }
                // Three of Zed's own settings layers, lowest first: what Setdown ships, the person's
                // Zed settings file as written, and what the person chose in Setdown. A project's
                // `.zed/settings.json` is read by Zed and stays above all three.
                "project.settings" => {
                    use gpui::UpdateGlobal as _;
                    // A language Zed has only through an extension (SCSS, Less) whose tool in Setdown
                    // is a server Zed ships. Its name and file endings are all a server needs.
                    let languages = this.read_with(cx, |this, _| this.languages.clone());
                    for language in request["languages"].as_array().into_iter().flatten() {
                        let name = language::LanguageName::new(text(language, "name")?);
                        if languages.available_language_for_name(name.as_ref()).is_some() {
                            continue;
                        }
                        let matcher = Arc::new(language::LanguageMatcher {
                            path_suffixes: language["suffixes"].as_array().into_iter().flatten()
                                .filter_map(|suffix| suffix.as_str()).map(|suffix| suffix.to_string().into()).collect(),
                            ..Default::default()
                        });
                        languages.register_language(name.clone(), None, matcher.clone(), false, None, Arc::new(move || {
                            let config = language::LanguageConfig { name: name.clone(), matcher: matcher.clone(), ..Default::default() };
                            async move {
                                Ok(language::LoadedLanguage { config, queries: Default::default(), context_provider: None,
                                    toolchain_provider: None, manifest_name: None })
                            }.boxed()
                        }));
                    }
                    cx.update(|cx| SettingsStore::update_global(cx, |store, cx| -> Result<Value> {
                        if let Some(defaults) = request["defaults"].as_str() {
                            let defaults: Value = serde_json::from_str(defaults).context("Invalid `defaults`")?;
                            ensure!(defaults.is_object(), "`defaults` must be an object");
                            store.set_global_settings(&shipped_settings(defaults), cx).result()?;
                        }
                        if let Some(choices) = request["choices"].as_str() {
                            store.set_server_settings(choices, cx)?;
                        }
                        // A mistake in the person's own file leaves their last valid settings in use.
                        let user = request["user"].as_str().map(|user| store.set_user_settings(user, cx).result());
                        Ok(json!({"user": user.and_then(|result| result.err()).map(|error| format!("{error:#}"))}))
                    }))?
                }
                "project.open" => Self::open(&weak, &request, cx).await?,
                "project.change" => this.update(cx, |this, cx| -> Result<Value> {
                    let changed = this.change(&request, cx)?;
                    this.pull_diagnostics(text(&request, "workspace")?, &absolute(&request, "path")?, cx);
                    Ok(changed)
                })?,
                "project.saved" => {
                    let path = absolute(&request, "path")?;
                    let fs = this.read_with(cx, |this, _| this.fs.clone());
                    let mtime = fs.metadata(&path).await?.map(|metadata| metadata.mtime);
                    this.update(cx, |this, cx| this.saved(&request, mtime, cx))?
                }
                "project.close" => this.update(cx, |this, _| this.close(&request))?,
                "project.servers" => {
                    let path = absolute(&request, "path")?;
                    this.update(cx, |this, cx| this.servers(text(&request, "workspace")?, &path, cx))?
                }
                "project.diagnostics" => {
                    let path = absolute(&request, "path")?;
                    this.update(cx, |this, cx| anyhow::Ok(this.publish_diagnostics(text(&request, "workspace")?, &path, false, cx)))?;
                    json!({})
                }
                "project.request" => {
                    this.update(cx, |this, cx| this.request(id, &request, cx))?;
                    return Ok(None);
                }
                "project.cancel" => {
                    let target = request["request"].as_u64().context("Missing `request`")?;
                    json!({"cancelled": this.update(cx, |this, _| this.requests.remove(&target)).is_some()})
                }
                "project.restart" => this.update(cx, |this, cx| this.restart(&request, cx))?,
                "project.dispose" => {
                    this.update(cx, |this, cx| this.dispose(id, &request, cx))?;
                    return Ok(None);
                }
                "project.notify" => this.update(cx, |this, cx| this.notify(&request, cx))?,
                "project.applyEditResult" => {
                    let edit = request["edit"].as_u64().context("Missing `edit`")?;
                    let answer = (request["applied"].as_bool().unwrap_or(false), request["failureReason"].as_str().map(str::to_string));
                    let sender = this.update(cx, |this, _| this.edits.remove(&edit)).ok_or_else(|| anyhow!("Unknown edit"))?;
                    json!({"delivered": sender.send(answer).is_ok()})
                }
                "project.schemaContentResult" => {
                    let schema = request["request"].as_u64().context("Missing `request`")?;
                    let answer = match request["content"].as_str() {
                        Some(content) => Ok(content.to_string()),
                        None => Err((request["code"].as_i64().unwrap_or(SCHEMA_REQUEST_FAILED), request["error"].as_str().unwrap_or("The schema could not be loaded.").to_string())),
                    };
                    let sender = this.update(cx, |this, _| this.schemas.remove(&schema)).ok_or_else(|| anyhow!("Unknown schema request"))?;
                    json!({"delivered": sender.send(answer).is_ok()})
                }
                other => bail!("Unknown operation {other}"),
            }))
        }.await;
        match result {
            Ok(Some(value)) => emit(json!({"id": id, "result": value})),
            Ok(None) => {}
            Err(error) => emit(json!({"id": id, "error": format!("{error:#}")})),
        }
    }
}
