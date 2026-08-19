#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Difftastic.app installation is currently supported on macOS only." >&2
    exit 1
fi

if ! cargo tauri --version >/dev/null 2>&1; then
    echo "The Tauri CLI is required. Install it once with:" >&2
    echo "  cargo install tauri-cli --version 2.11.4 --locked" >&2
    exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tauri_dir="${script_dir}/src-tauri"
built_app="${tauri_dir}/target/release/bundle/macos/Difftastic.app"
user_applications_dir="${HOME:?}/Applications"
installed_app="${user_applications_dir}/Difftastic.app"
staging_app="${user_applications_dir}/.Difftastic.app.installing"
backup_app="${user_applications_dir}/.Difftastic.app.previous"
launch_services="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

echo "Building the latest Difftastic GUI…"
(
    cd "$tauri_dir"
    cargo tauri build --bundles app
)

if [[ ! -d "$built_app" ]]; then
    echo "Tauri finished without producing the expected app bundle:" >&2
    echo "  $built_app" >&2
    exit 1
fi

mkdir -p "$user_applications_dir"

# Stop the installed copy before replacing it. Failure is harmless when the
# application is not currently running.
osascript -e 'tell application id "dev.difftastic.studio" to quit' >/dev/null 2>&1 || true

# Keep the old app recoverable until the newly built bundle is in place.
rm -rf "$staging_app" "$backup_app"
ditto "$built_app" "$staging_app"

# Cargo emits a linker-signed executable, but the containing bundle still
# needs a local ad-hoc signature so Info.plist and the generated icon are
# sealed together. No Apple developer certificate is needed for this local app.
codesign --force --deep --sign - "$staging_app"

if [[ -e "$installed_app" ]]; then
    mv "$installed_app" "$backup_app"
fi
if mv "$staging_app" "$installed_app"; then
    rm -rf "$backup_app"
else
    if [[ -e "$backup_app" ]]; then
        mv "$backup_app" "$installed_app"
    fi
    exit 1
fi

# Register immediately instead of waiting for Spotlight/Launch Services to
# notice the new bundle. Raycast's Applications search reads this app index.
if [[ -x "$launch_services" ]]; then
    "$launch_services" -f "$installed_app"
fi

open "$installed_app"
echo
echo "Installed and launched: $installed_app"
echo "You can now type Difftastic in Raycast to open it."
