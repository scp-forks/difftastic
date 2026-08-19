default:
    @just --list

# Launch the visual Tauri frontend.
studio:
    cd visual/src-tauri && cargo run

# Build, install, and launch Difftacular.app for Raycast/macOS app search.
install-studio:
    bash visual/install-macos.sh

# Publish a new Difftacular release. GitHub bumps the version, builds the macOS,
# Linux and Windows installers, and publishes them. Pass minor or major to
# change the bump. Requires the gh CLI.
release-studio bump="patch":
    gh workflow run difftacular-release.yml --ref feature/difftastic-studio -f bump={{bump}}
    @echo "Started. Watch it with: gh run watch --repo scp-forks/difftastic"

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
