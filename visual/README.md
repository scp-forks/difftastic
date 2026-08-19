# Difftastic Studio

A small Tauri 2 desktop frontend that renders difftastic's own structured,
syntax-aware diff output. The frontend is dependency-free HTML, CSS and
JavaScript; the Tauri command calls the library adapter in the repository root.

## Run it

From `visual/src-tauri`:

```sh
cargo tauri dev
```

If the Tauri CLI is not installed, the app can also be launched directly:

```sh
cargo run
```

## Install it for Raycast on macOS

Install the Tauri CLI once:

```sh
cargo install tauri-cli --version 2.11.4 --locked
```

Then, from the repository root:

```sh
just install-studio
```

This builds the current source in release mode, safely replaces
`~/Applications/Difftastic.app`, registers it with macOS Launch Services, and
launches it. Raycast can then open it by searching for **Difftastic**. Run the
same command again whenever you want to deploy the latest local GUI changes.

Drop one file directly onto the Original or Changed card to choose its side. If
two files are dragged together, drop them anywhere: the first becomes Original,
the second becomes Changed, and comparison starts automatically. You can also
click either card to use the native file picker, or hover or keyboard-focus a
side and press <kbd>Ctrl+V</kbd> or <kbd>⌘V</kbd> to compare pasted text. After the
first paste, the other empty side is selected automatically for the next paste.
Long lines are contained within their side and can be horizontally scrolled, or
you can enable **Word wrap** in the comparison toolbar. **Ignore edge
whitespace** removes spaces and tabs at the beginning and end of each line from
the comparison while keeping internal whitespace meaningful.
