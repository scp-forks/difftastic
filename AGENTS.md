# Repository Agent Instructions

## Repository and branch topology

- This repository is the `scp-forks/difftastic` fork of the canonical
  `Wilfred/difftastic` project.
- The `origin` remote is the user's fork:
  `https://github.com/scp-forks/difftastic`.
- The `upstream` remote is the canonical project:
  `https://github.com/Wilfred/difftastic.git`.
- Difftacular is fork-specific work developed on
  `feature/difftastic-studio`. Keep Difftacular changes on that feature branch
  unless the user explicitly asks to merge or move them elsewhere. Do not make
  Difftacular changes directly on `master`.
- Preserve a clean path for upstream updates. When the user asks to sync from
  upstream, fetch `upstream`, update the fork's `master` from
  `upstream/master`, and then merge the updated `master` into
  `feature/difftastic-studio`. Prefer a normal merge for an already-published
  feature branch; do not rewrite its history unless the user explicitly asks.
- Never push to the canonical `upstream` remote. Treat commits, pushes, branch
  merges, rebases, and upstream synchronization as separate actions that each
  require explicit user authorization.

## Difftacular deployment

- After making changes that affect the Difftacular GUI, its Rust visual
  adapter, or its Tauri integration, verify the relevant code and tests during
  development.
- Once the user confirms they are satisfied with the changes, run
  `just install-studio` from the repository root before considering the work
  complete. This must rebuild the current release app, replace
  `~/Applications/Difftacular.app`, register it with macOS Launch Services, and
  launch it so the latest accepted build is immediately available through
  Raycast by searching for **Difftacular**.
- Do not commit or push as part of deployment unless the user explicitly asks
  for those actions.

## Difftacular releases

- Installers for macOS, Linux and Windows are built and published by
  `.github/workflows/difftacular-release.yml`. Start a release from the
  repository's Actions tab or with `just release-studio [patch|minor|major]`.
- Release tags are prefixed, as in `difftacular-v0.2.0`. Never tag a
  Difftacular release with a bare version number: those tags trigger the
  inherited upstream `release.yml`, which publishes difftastic to crates.io.
- `visual/scripts/set-version.mjs` is the only thing that should edit the
  Difftacular version. It keeps `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`
  in step so release builds stay `--locked`.
- Publishing a release is a user-facing action and needs explicit user
  authorization, in the same way as a commit or a push.
