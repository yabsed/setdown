# Language tools on real projects

Run 2026-11-20T14:23:02.563Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code | Its extension's requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rust | BurntSushi/walkdir | rust-analyzer | yes (0.4 s) | yes, 5.2 s | yes, 2.2 s | yes (2 of 2), 2.2 s | yes, 1.1 s | yes (2 of 2), 1.1 s | – | yes (9 of 9), 1.2 s |

Every expectation was met.

"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.

## What each tool answered

### Rust: `src/lib.rs` in BurntSushi/walkdir@6fd031c82b

rust-analyzer, installed by Setdown.

- clean: no error
- mistake `fn setdown_mistake() { setdown_mistake(1); }`: error: expected 0 arguments, found 1
- hover `from_path`: ```rust same_file::Handle ``` ```rust pub fn from_path<P>(p: P) -> io::Result<Handle> where P: AsRef<Path>, ``` --- `P` = `&P` --- Construct a handle from a pa…
- hover `read_dir`: ```rust std::fs ``` ```rust pub fn read_dir<P>(path: P) -> io::Result<ReadDir> where P: AsRef<Path>, ``` --- `P` = `&Path` --- Returns an iterator over the ent…
- completion `Handle::from_pa|`: 13 offered, first: from_path, from_file, stdin, stdout, stderr, as_file
- definition `from_path`: src/dent.rs:252
- definition `Handle`: ../../../../../../../../../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/same-file-1.0.6/src/lib.rs:109
- own `rust-analyzer/expandMacro`: {"name":"itry!","expansion":"match (DirEntry::from_path(0, start, false)) {\n Ok(v) => v,\n Err(err) => return Some(Err(From::from(err))),\n}\n"}
- own `experimental/runnables`: [{"label":"cargo check -p walkdir --all-targets","kind":"cargo","args":{"environment":{"RUSTC_TOOLCHAIN":"/home/yabsed/.rustup/toolchains/stable-x86_64-unknown…
- own `experimental/openCargoToml`: {"uri":"file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/walkdir/Cargo.toml","range":{"start":{"line":…
- own `experimental/childModules`: [{"targetUri":"file:///home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/lsp-benchmark/work/sources/walkdir/src/lib.rs","targetRange":{"st…
- own `experimental/externalDocs`: {"web":"https://doc.rust-lang.org/stable/std/fs/fn.read_dir.html","local":"file:///home/yabsed/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/share/doc/rus…
- own `experimental/matchingBrace`: [{"line":143,"character":0}]
- own `rust-analyzer/viewSyntaxTree`: {"type":"Node","kind":"SOURCE_FILE","start":[0,0,0],"end":[42460,1195,0],"children":[{"type":"Node","kind":"DOC_COMMENT","start":[0,0,0],"end":[2808,103,2],"ch…
- own `rust-analyzer/analyzerStatus`: Workspaces: Loaded 38 packages across 1 workspace. Workspace root folders: [AbsPath("/home/yabsed/Documents/fall26/work/projects/better-markdown-viewer/apps/ls…
- own `rust-analyzer/rebuildProcMacros`: null
