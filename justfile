default:
    @just --list

# Launch the visual Tauri frontend.
studio:
    cd visual/src-tauri && cargo run

# Build, install, and launch Difftacular.app for Raycast/macOS app search.
install-studio:
    bash visual/install-macos.sh

# Publish a new Difftacular release: bump the version and tag it. GitHub then
# builds the macOS, Linux and Windows installers and attaches them to a release.
# Pass minor or major to change the bump.
release-studio bump="patch":
    #!/usr/bin/env bash
    set -euo pipefail

    branch=feature/difftastic-studio

    if [ "$(git rev-parse --abbrev-ref HEAD)" != "$branch" ]; then
        echo "Difftacular releases are cut from $branch." >&2
        exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
        echo "Commit or stash your changes before releasing." >&2
        exit 1
    fi

    git fetch --quiet origin "$branch" --tags
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$branch")" ]; then
        echo "$branch and origin/$branch have diverged. Pull or push first." >&2
        exit 1
    fi

    version=$(node visual/scripts/set-version.mjs --bump {{bump}})
    tag="difftacular-v$version"

    git add visual/src-tauri/tauri.conf.json \
            visual/src-tauri/Cargo.toml \
            visual/src-tauri/Cargo.lock
    git commit --quiet -m "Difftacular $version"
    git tag -a "$tag" -m "Difftacular $version"
    git push --quiet origin "$branch"
    git push --quiet origin "$tag"

    echo "Tagged $tag. GitHub is building the installers:"
    echo "  https://github.com/scp-forks/difftastic/actions"

# Build and serve the manual.
doc:
    cd manual && mdbook serve --open

# Run the output regression test.
compare:
    sample_files/compare_all.sh

# Create a git tag and push it, to trigger a release on GitHub actions.
release:
    #!/bin/bash

    set -ex

    VERSION=$(cargo metadata --format-version=1 | jq -r '.packages | .[] | select(.name == "difftastic") | .version')
    git tag $VERSION
    git push --tags

    cargo set-version --bump minor

# Serve the homepage locally.
home:
    echo "http://localhost:8080"
    cd homepage && python -m http.server 8080

# Generate release notes for the currently unreleased version.
rel_notes:
    #!/bin/bash

    echo -e "Difftastic is a structural diff tool that understands syntax. See [the manual](https://difftastic.wilfred.me.uk/introduction.html) to get started, and [the changelog](https://github.com/Wilfred/difftastic/blob/master/CHANGELOG.md) for historical changes.\n"

    rg --max-count 1 -B 9999 "released " CHANGELOG.md | tail -n +3 | head -n -2 | awk 'BEGIN{RS="\n\n"; ORS="\n\n"} {gsub(/\n/, " "); print}'

# Regenerate the man page difft.1 from diff.1.md.
man:
    pandoc --standalone --to man difft.1.md -o difft.1

# Run perf stat on baseline test files and save results.
perf:
    #!/bin/bash
    set -e

    cargo build --release

    TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
    OUTFILE="perf_baseline_${TIMESTAMP}.txt"

    echo '$ perf stat ./target/release/difft sample_files/typing_1.ml sample_files/typing_2.ml >/dev/null' >> "$OUTFILE"
    perf stat ./target/release/difft sample_files/typing_1.ml sample_files/typing_2.ml >/dev/null 2>> "$OUTFILE"

    echo '$ perf stat ./target/release/difft sample_files/slow_1.rs sample_files/slow_2.rs >/dev/null' >> "$OUTFILE"
    perf stat ./target/release/difft sample_files/slow_1.rs sample_files/slow_2.rs >/dev/null 2>> "$OUTFILE"

    echo "Results written to $OUTFILE"
