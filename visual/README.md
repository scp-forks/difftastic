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

Drop one file directly onto the Original or Changed card to choose its side. If
two files are dragged together, drop them anywhere: the first becomes Original,
the second becomes Changed, and comparison starts automatically. You can also
click either card to use the native file picker, or hover or keyboard-focus a
side and press <kbd>Ctrl+V</kbd> or <kbd>⌘V</kbd> to compare pasted text. After the
first paste, the other empty side is selected automatically for the next paste.
Long lines are contained within their side and can be horizontally scrolled, or
you can enable **Word wrap** in the comparison toolbar.
