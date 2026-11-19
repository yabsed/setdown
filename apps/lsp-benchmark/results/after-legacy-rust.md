# Language tools on real projects

Run 2026-11-19T12:15:27.426Z on linux x64, kept profile.

| Language | Project | Tool | Starts | No false errors | Marks a mistake | Hover | Completion | Go to definition | Fades left-out code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rust | BurntSushi/walkdir | rust-analyzer | yes (0.4 s) | yes, 5.2 s | yes, 2.2 s | yes (2 of 2), 2.2 s | yes, 1.2 s | yes (2 of 2), 1.2 s | – |

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
