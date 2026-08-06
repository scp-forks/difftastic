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

Drop two files anywhere in the window, drop one file and then another, or click
either file card to use the native picker.
