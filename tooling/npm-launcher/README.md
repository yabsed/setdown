# Setdown

Setdown is a desktop Markdown reader and editor: write in plain text, then read
your words as a typeset document. This package installs a `setdown` command
that downloads the desktop app and starts it.

```bash
npm install -g @yabsed/setdown
setdown notes.md
```

It runs on Linux x64 and Windows x64 and needs Node.js 20 or later.

## What the command does

The first time you run a version, `setdown` downloads that version of the app
from its [GitHub release](https://github.com/yabsed/setdown/releases), checks
it against the SHA-256 recorded in this package, and unpacks it into your user
cache. The download is several hundred megabytes. Later runs start the app
directly.

| System | Where the app is kept |
|---|---|
| Linux | `~/.cache/setdown-npm`, or `$XDG_CACHE_HOME/setdown-npm` |
| Windows | `%LOCALAPPDATA%\setdown-npm` |

Arguments go to the app, so `setdown notes.md` opens a file and
`setdown some/folder` opens a folder. Nothing is downloaded during
`npm install`.

## Updating and removing

`npm update -g @yabsed/setdown` updates the command. The next run downloads the
matching app and deletes the previous one.

To remove Setdown, run `npm uninstall -g @yabsed/setdown` and delete the cache
directory above.

## Limits

- The command does not add Setdown to your application menu or open files from
  your file manager. For that, use an installer (`.deb`, `.rpm`, `.AppImage`
  or `.exe`) from the [releases page](https://github.com/yabsed/setdown/releases/latest).
- On Ubuntu 24.04 and later, an app unpacked into your home directory may fail
  to start with a sandbox error. Install the `.deb` instead.
- To download from a mirror, set `SETDOWN_DOWNLOAD_BASE_URL` to a directory
  URL that holds the release files. The checksum is still enforced.

## License

[GPL-3.0-only](https://github.com/yabsed/setdown/blob/main/LICENSE).
