# Repository Agent Instructions

## Difftastic Studio deployment

- After making changes that affect the Difftastic Studio GUI, its Rust visual
  adapter, or its Tauri integration, verify the relevant code and tests during
  development.
- Once the user confirms they are satisfied with the changes, run
  `just install-studio` from the repository root before considering the work
  complete. This must rebuild the current release app, replace
  `~/Applications/Difftastic.app`, register it with macOS Launch Services, and
  launch it so the latest accepted build is immediately available through
  Raycast by searching for **Difftastic**.
- Do not commit or push as part of deployment unless the user explicitly asks
  for those actions.
