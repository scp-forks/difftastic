#!/usr/bin/env node
// Keep the Difftacular version in sync across the three files that record it.
//
//   node visual/scripts/set-version.mjs --print
//   node visual/scripts/set-version.mjs --bump patch|minor|major
//   node visual/scripts/set-version.mjs --set 1.2.3
//
// The resulting version is written to stdout on its own line so release
// tooling can capture it. Everything else goes to stderr.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const confPath = join(repoRoot, "visual", "src-tauri", "tauri.conf.json");
const cargoPath = join(repoRoot, "visual", "src-tauri", "Cargo.toml");
const lockPath = join(repoRoot, "visual", "src-tauri", "Cargo.lock");

// Tauri and the Windows MSI bundler both require a plain three-part version.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`set-version: ${message}`);
  process.exit(1);
}

function currentVersion() {
  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  if (typeof conf.version !== "string") {
    fail(`no "version" string in ${confPath}`);
  }
  if (!SEMVER.test(conf.version)) {
    fail(`current version "${conf.version}" is not a MAJOR.MINOR.PATCH version`);
  }
  return conf.version;
}

function bump(version, part) {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (part) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return fail(`unknown bump "${part}", expected major, minor or patch`);
  }
}

// Every pattern below captures the text either side of the version and leaves
// the line ending alone, because Git for Windows checks these files out with
// CRLF and the release workflow runs this script there too.
//
// Replace exactly one occurrence, so a silently unmatched pattern is an error
// rather than a file that keeps its old version.
function replaceOnce(text, pattern, replacement, label) {
  const matches = text.match(pattern);
  if (!matches) {
    fail(`could not find the version field in ${label}`);
  }
  return text.replace(pattern, replacement);
}

function write(version) {
  const conf = readFileSync(confPath, "utf8");
  writeFileSync(
    confPath,
    replaceOnce(
      conf,
      /^(\s*"version"\s*:\s*")[^"]*(")/m,
      `$1${version}$2`,
      confPath,
    ),
  );

  const cargo = readFileSync(cargoPath, "utf8");
  writeFileSync(
    cargoPath,
    replaceOnce(cargo, /^(version = ")[^"]*(")/m, `$1${version}$2`, cargoPath),
  );

  // Updating the lockfile in place keeps `cargo build --locked` working, so
  // release builds still use the exact dependency versions that were tested.
  const lock = readFileSync(lockPath, "utf8");
  writeFileSync(
    lockPath,
    replaceOnce(
      lock,
      /^(name = "difftacular"\r?\nversion = ")[^"]*(")/m,
      `$1${version}$2`,
      lockPath,
    ),
  );
}

const [flag, value] = process.argv.slice(2);
const current = currentVersion();

if (flag === "--print" || flag === undefined) {
  console.log(current);
  process.exit(0);
}

let next;
if (flag === "--bump") {
  next = bump(current, value);
} else if (flag === "--set") {
  if (!SEMVER.test(value ?? "")) {
    fail(`"${value}" is not a MAJOR.MINOR.PATCH version`);
  }
  next = value;
} else {
  fail(`unknown option "${flag}", expected --print, --bump or --set`);
}

write(next);
console.error(`set-version: ${current} -> ${next}`);
console.log(next);
