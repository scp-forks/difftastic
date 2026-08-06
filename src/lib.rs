//! Reusable difftastic engine APIs.
//!
//! The command-line binary remains the primary interface. This library target
//! exposes the same parser and matcher to other local frontends, including the
//! Tauri app in `visual/`.

#![allow(renamed_and_removed_lints)]
#![allow(clippy::type_complexity)]
#![allow(clippy::comparison_to_empty)]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::if_same_then_else)]
#![allow(clippy::mutable_key_type)]
#![allow(unknown_lints)]
#![allow(clippy::manual_unwrap_or_default)]
#![allow(clippy::implicit_saturating_sub)]
#![allow(clippy::needless_as_bytes)]
// Several CLI-only helpers are compiled into the library because the mature
// diff engine modules share those types. They remain used by the binary target.
#![allow(dead_code)]

#[macro_use]
extern crate log;

mod constants;
mod diff;
mod display;
mod exit_codes;
mod files;
mod hash;
mod line_parser;
mod lines;
mod options;
mod parse;
mod summary;
mod version;
mod words;

mod visual;

// A number of long-standing module tests use this crate-root shorthand, as the
// CLI target does in `main.rs`.
#[cfg(test)]
pub(crate) use parse::syntax;

pub use visual::{visual_diff, VisualDiffOptions};

/// Ensure Cargo carries the library target's native parser link metadata into
/// binaries in this package. The function itself intentionally has no runtime
/// behavior.
#[doc(hidden)]
pub fn link_native_parsers() {}
