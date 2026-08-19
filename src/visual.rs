//! High-level adapter for visual difftastic frontends.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use humansize::{format_size, FormatSizeOptions, BINARY};
use serde::Serialize;
use typed_arena::Arena;

use crate::constants::Side;
use crate::diff::changes::ChangeMap;
use crate::diff::shortest_path::{mark_syntax, ExceededGraphLimit};
use crate::diff::sliders::fix_all_sliders;
use crate::diff::unchanged;
use crate::display::context::opposite_positions;
use crate::display::hunks::{matched_pos_to_hunks, merge_adjacent};
use crate::lines::MaxLine;
use crate::options::{DiffOptions, DisplayOptions, FileArgument};
use crate::parse::guess_language::{guess, language_name};
use crate::parse::syntax::{self, init_next_prev};
use crate::parse::tree_sitter_parser as tsp;
use crate::summary::{DiffResult, FileContent, FileFormat};

/// User-facing controls supported by the visual adapter.
#[derive(Debug, Clone, Copy)]
pub struct VisualDiffOptions {
    pub ignore_comments: bool,
    pub ignore_edge_whitespace: bool,
    pub strip_cr: bool,
}

impl Default for VisualDiffOptions {
    fn default() -> Self {
        Self {
            ignore_comments: false,
            ignore_edge_whitespace: false,
            strip_cr: true,
        }
    }
}

/// A source shown on either side of a visual comparison.
#[derive(Debug, Clone)]
pub enum VisualDiffInput {
    File(PathBuf),
    Text { name: String, content: String },
}

struct PreparedInput {
    name: String,
    path: String,
    content: String,
    bytes: usize,
}

#[derive(Serialize)]
struct VisualFile {
    name: String,
    path: String,
    content: String,
    bytes: usize,
    lines: usize,
}

#[derive(Serialize)]
struct VisualResponse {
    lhs: VisualFile,
    rhs: VisualFile,
    diff: serde_json::Value,
    has_syntactic_changes: bool,
    language: String,
}

/// Compare two paths with difftastic's syntax-aware engine and return the
/// visual frontend's JSON view model.
pub fn visual_diff(
    lhs_path: impl AsRef<Path>,
    rhs_path: impl AsRef<Path>,
    options: VisualDiffOptions,
) -> Result<String, String> {
    visual_diff_inputs(
        VisualDiffInput::File(lhs_path.as_ref().to_path_buf()),
        VisualDiffInput::File(rhs_path.as_ref().to_path_buf()),
        options,
    )
}

/// Compare any combination of files and in-memory text with difftastic's
/// syntax-aware engine.
pub fn visual_diff_inputs(
    lhs_input: VisualDiffInput,
    rhs_input: VisualDiffInput,
    options: VisualDiffOptions,
) -> Result<String, String> {
    let lhs_input = prepare_input(lhs_input)?;
    let rhs_input = prepare_input(rhs_input)?;
    let display_path = if rhs_input.name.is_empty() {
        lhs_input.name.clone()
    } else {
        rhs_input.name.clone()
    };
    let rhs_argument = FileArgument::NamedPath(PathBuf::from(&display_path));
    let mut lhs_src = lhs_input.content.clone();
    let mut rhs_src = rhs_input.content.clone();

    if options.strip_cr {
        lhs_src.retain(|character| character != '\r');
        rhs_src.retain(|character| character != '\r');
    }
    ensure_trailing_newline(&mut lhs_src);
    ensure_trailing_newline(&mut rhs_src);

    let (lhs_diff_src, rhs_diff_src) = if options.ignore_edge_whitespace {
        (
            trim_line_edge_whitespace(&lhs_src),
            trim_line_edge_whitespace(&rhs_src),
        )
    } else {
        (lhs_src.clone(), rhs_src.clone())
    };

    let diff_options = DiffOptions {
        ignore_comments: options.ignore_comments,
        strip_cr: options.strip_cr,
        ..DiffOptions::default()
    };
    let display_options = DisplayOptions {
        // The JSON projection calculates its own compact chunks. The visual
        // frontend applies context dynamically without re-running the diff.
        num_context_lines: 0,
        ..DisplayOptions::default()
    };

    let result = diff_file_content(
        &display_path,
        &rhs_argument,
        &lhs_diff_src,
        &rhs_diff_src,
        &display_options,
        &diff_options,
    );
    let language = result.file_format.to_string();
    let has_syntactic_changes = result.has_syntactic_changes;
    let mut diff = crate::display::json::to_value(&result);
    if options.ignore_edge_whitespace {
        shift_visual_change_offsets(&mut diff, &lhs_src, &rhs_src);
    }
    let response = VisualResponse {
        lhs: visual_file(lhs_input, lhs_src),
        rhs: visual_file(rhs_input, rhs_src),
        diff,
        has_syntactic_changes,
        language,
    };

    serde_json::to_string(&response).map_err(|error| format!("Could not encode diff: {error}"))
}

fn prepare_input(input: VisualDiffInput) -> Result<PreparedInput, String> {
    match input {
        VisualDiffInput::File(path) => {
            let bytes = read_file(&path)?;
            let argument = FileArgument::NamedPath(path.clone());
            let content = decode_text(&bytes, &argument)?;
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string());
            Ok(PreparedInput {
                name,
                path: path.display().to_string(),
                content,
                bytes: bytes.len(),
            })
        }
        VisualDiffInput::Text { name, content } => {
            let name = if name.trim().is_empty() {
                "pasted.txt".to_owned()
            } else {
                name
            };
            Ok(PreparedInput {
                name,
                path: "Pasted content".to_owned(),
                bytes: content.len(),
                content,
            })
        }
    }
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("Could not read {}: {error}", path.display()))
}

fn decode_text(bytes: &[u8], path: &FileArgument) -> Result<String, String> {
    match crate::files::guess_content(bytes, path, &[]) {
        crate::files::ProbableFileKind::Text(content) => Ok(content),
        crate::files::ProbableFileKind::Binary => Err(format!(
            "{} looks like a binary file. The visual viewer currently compares text and source files.",
            path
        )),
    }
}

fn ensure_trailing_newline(content: &mut String) {
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
}

/// Trim spaces and tabs at each line edge while retaining the exact newline
/// sequence. This is intentionally opt-in because leading whitespace is
/// meaningful in some languages.
fn trim_line_edge_whitespace(content: &str) -> String {
    let mut trimmed = String::with_capacity(content.len());
    for segment in content.split_inclusive('\n') {
        let (line, has_lf) = segment
            .strip_suffix('\n')
            .map_or((segment, false), |line| (line, true));
        let (line, has_cr) = line
            .strip_suffix('\r')
            .map_or((line, false), |line| (line, true));
        trimmed.push_str(line.trim_matches(|character| matches!(character, ' ' | '\t')));
        if has_cr {
            trimmed.push('\r');
        }
        if has_lf {
            trimmed.push('\n');
        }
    }
    trimmed
}

/// The diff engine sees edge-trimmed lines, but the visual response retains
/// the original text. Shift change byte offsets past each original line's
/// leading spaces/tabs so token highlights still land on the correct text.
fn shift_visual_change_offsets(diff: &mut serde_json::Value, lhs_src: &str, rhs_src: &str) {
    let lhs_offsets = leading_edge_byte_offsets(lhs_src);
    let rhs_offsets = leading_edge_byte_offsets(rhs_src);
    let Some(chunks) = diff
        .get_mut("chunks")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };

    for chunk in chunks {
        let Some(lines) = chunk.as_array_mut() else {
            continue;
        };
        for line in lines {
            shift_side_change_offsets(line, "lhs", &lhs_offsets);
            shift_side_change_offsets(line, "rhs", &rhs_offsets);
        }
    }
}

fn leading_edge_byte_offsets(content: &str) -> Vec<usize> {
    content
        .split('\n')
        .map(|line| {
            line.len()
                - line
                    .trim_start_matches(|character| matches!(character, ' ' | '\t'))
                    .len()
        })
        .collect()
}

fn shift_side_change_offsets(
    line: &mut serde_json::Value,
    side_name: &str,
    leading_offsets: &[usize],
) {
    let Some(side) = line.get_mut(side_name) else {
        return;
    };
    let Some(line_number) = side.get("line_number").and_then(serde_json::Value::as_u64) else {
        return;
    };
    let leading_offset = leading_offsets
        .get(line_number as usize)
        .copied()
        .unwrap_or_default() as u64;
    let Some(changes) = side
        .get_mut("changes")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };

    for change in changes {
        for edge in ["start", "end"] {
            let Some(offset) = change.get_mut(edge) else {
                continue;
            };
            if let Some(value) = offset.as_u64() {
                *offset = serde_json::Value::from(value + leading_offset);
            }
        }
    }
}

fn visual_file(input: PreparedInput, content: String) -> VisualFile {
    let lines = if content.is_empty() {
        0
    } else {
        content.lines().count()
    };
    VisualFile {
        name: input.name,
        path: input.path,
        content,
        bytes: input.bytes,
        lines,
    }
}

fn check_only_text(
    file_format: &FileFormat,
    display_path: &str,
    lhs_src: &str,
    rhs_src: &str,
) -> DiffResult {
    let has_byte_changes =
        (lhs_src != rhs_src).then_some((lhs_src.as_bytes().len(), rhs_src.as_bytes().len()));
    DiffResult {
        display_path: display_path.to_owned(),
        extra_info: None,
        file_format: file_format.clone(),
        lhs_src: FileContent::Text(lhs_src.into()),
        rhs_src: FileContent::Text(rhs_src.into()),
        lhs_positions: vec![],
        rhs_positions: vec![],
        hunks: vec![],
        has_byte_changes,
        has_syntactic_changes: lhs_src != rhs_src,
    }
}

fn diff_file_content(
    display_path: &str,
    rhs_path: &FileArgument,
    lhs_src: &str,
    rhs_src: &str,
    display_options: &DisplayOptions,
    diff_options: &DiffOptions,
) -> DiffResult {
    let guess_src = match rhs_path {
        FileArgument::DevNull => lhs_src,
        _ => rhs_src,
    };
    let language = guess(Path::new(display_path), guess_src, &[]);
    let lang_config = language.map(|lang| (lang, tsp::from_language(lang)));

    if lhs_src == rhs_src {
        let file_format = language.map_or(FileFormat::PlainText, FileFormat::SupportedLanguage);
        return DiffResult {
            extra_info: None,
            display_path: display_path.to_owned(),
            file_format,
            lhs_src: FileContent::Text(String::new()),
            rhs_src: FileContent::Text(String::new()),
            lhs_positions: vec![],
            rhs_positions: vec![],
            hunks: vec![],
            has_byte_changes: None,
            has_syntactic_changes: false,
        };
    }

    let (file_format, lhs_positions, rhs_positions) = match lang_config {
        None => {
            let file_format = FileFormat::PlainText;
            if diff_options.check_only {
                return check_only_text(&file_format, display_path, lhs_src, rhs_src);
            }
            let (lhs_positions, rhs_positions) =
                crate::line_parser::change_positions(lhs_src, rhs_src);
            (file_format, lhs_positions, rhs_positions)
        }
        Some((language, lang_config)) => {
            let arena = Arena::new();
            match tsp::to_tree_with_limit(diff_options, lang_config, lhs_src, rhs_src) {
                Ok((lhs_tree, rhs_tree)) => match tsp::to_syntax_with_limit(
                    lhs_src,
                    rhs_src,
                    &lhs_tree,
                    &rhs_tree,
                    &arena,
                    lang_config,
                    diff_options,
                ) {
                    Ok((lhs, rhs)) => {
                        if diff_options.check_only {
                            return check_only_text(
                                &FileFormat::SupportedLanguage(language),
                                display_path,
                                lhs_src,
                                rhs_src,
                            );
                        }

                        let mut change_map = ChangeMap::default();
                        let possibly_changed = if env::var("DFT_DBG_KEEP_UNCHANGED").is_ok() {
                            vec![(lhs.clone(), rhs.clone())]
                        } else {
                            unchanged::mark_unchanged(&lhs, &rhs, &mut change_map)
                        };
                        let mut exceeded_graph_limit = false;
                        for (lhs_nodes, rhs_nodes) in possibly_changed {
                            init_next_prev(&lhs_nodes);
                            init_next_prev(&rhs_nodes);
                            if let Err(ExceededGraphLimit {}) = mark_syntax(
                                lhs_nodes.first().copied(),
                                rhs_nodes.first().copied(),
                                &mut change_map,
                                diff_options.graph_limit,
                            ) {
                                exceeded_graph_limit = true;
                                break;
                            }
                        }

                        if exceeded_graph_limit {
                            let (lhs_positions, rhs_positions) =
                                crate::line_parser::change_positions(lhs_src, rhs_src);
                            (
                                FileFormat::TextFallback {
                                    reason: "exceeded DFT_GRAPH_LIMIT".into(),
                                },
                                lhs_positions,
                                rhs_positions,
                            )
                        } else {
                            fix_all_sliders(language, &lhs, &mut change_map);
                            fix_all_sliders(language, &rhs, &mut change_map);
                            let mut lhs_positions = syntax::change_positions(&lhs, &change_map);
                            let mut rhs_positions = syntax::change_positions(&rhs, &change_map);
                            if diff_options.ignore_comments {
                                lhs_positions.extend(tsp::comment_positions(
                                    &lhs_tree,
                                    lhs_src,
                                    lang_config,
                                ));
                                rhs_positions.extend(tsp::comment_positions(
                                    &rhs_tree,
                                    rhs_src,
                                    lang_config,
                                ));
                            }
                            (
                                FileFormat::SupportedLanguage(language),
                                lhs_positions,
                                rhs_positions,
                            )
                        }
                    }
                    Err(tsp::ExceededParseErrorLimit {
                        error_count,
                        first_error_pos,
                    }) => {
                        let location =
                            first_error_pos.map_or_else(String::new, |(line, col, side)| {
                                let initial = if side == Side::Left {
                                    " in initial file"
                                } else {
                                    ""
                                };
                                format!(", first at {}:{}{}", line.display(), col, initial)
                            });
                        let file_format = FileFormat::TextFallback {
                            reason: format!(
                                "{} {} parse error{}, exceeded DFT_PARSE_ERROR_LIMIT{}",
                                error_count,
                                language_name(language),
                                if error_count == 1 { "" } else { "s" },
                                location
                            ),
                        };
                        let (lhs_positions, rhs_positions) =
                            crate::line_parser::change_positions(lhs_src, rhs_src);
                        (file_format, lhs_positions, rhs_positions)
                    }
                },
                Err(tsp::ExceededByteLimit(num_bytes)) => {
                    let format_options = FormatSizeOptions::from(BINARY).decimal_places(1);
                    let file_format = FileFormat::TextFallback {
                        reason: format!(
                            "{} exceeded DFT_BYTE_LIMIT",
                            format_size(num_bytes, format_options)
                        ),
                    };
                    let (lhs_positions, rhs_positions) =
                        crate::line_parser::change_positions(lhs_src, rhs_src);
                    (file_format, lhs_positions, rhs_positions)
                }
            }
        }
    };

    let opposite_to_lhs = opposite_positions(&lhs_positions);
    let opposite_to_rhs = opposite_positions(&rhs_positions);
    let hunks = matched_pos_to_hunks(&lhs_positions, &rhs_positions);
    let hunks = merge_adjacent(
        &hunks,
        &opposite_to_lhs,
        &opposite_to_rhs,
        lhs_src.max_line(),
        rhs_src.max_line(),
        display_options.num_context_lines as usize,
    );
    let has_syntactic_changes = !hunks.is_empty();
    DiffResult {
        extra_info: None,
        display_path: display_path.to_owned(),
        file_format,
        lhs_src: FileContent::Text(lhs_src.to_owned()),
        rhs_src: FileContent::Text(rhs_src.to_owned()),
        lhs_positions,
        rhs_positions,
        hunks,
        has_byte_changes: Some((lhs_src.as_bytes().len(), rhs_src.as_bytes().len())),
        has_syntactic_changes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_structured_syntax_diff_for_visual_frontend() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let response = visual_diff(
            root.join("sample_files/comments_1.rs"),
            root.join("sample_files/comments_2.rs"),
            VisualDiffOptions::default(),
        )
        .unwrap();
        let response: serde_json::Value = serde_json::from_str(&response).unwrap();

        assert_eq!(response["language"], "Rust");
        assert_eq!(response["has_syntactic_changes"], true);
        assert!(response["diff"]["aligned_lines"].is_array());
        assert!(response["diff"]["chunks"].is_array());
        assert_eq!(response["lhs"]["name"], "comments_1.rs");
        assert_eq!(response["rhs"]["name"], "comments_2.rs");
    }

    #[test]
    fn compares_pasted_text_with_the_named_language() {
        let response = visual_diff_inputs(
            VisualDiffInput::Text {
                name: "pasted-original.rs".to_owned(),
                content: "fn answer() -> u8 { 41 }".to_owned(),
            },
            VisualDiffInput::Text {
                name: "pasted-changed.rs".to_owned(),
                content: "fn answer() -> u8 { 42 }".to_owned(),
            },
            VisualDiffOptions::default(),
        )
        .unwrap();
        let response: serde_json::Value = serde_json::from_str(&response).unwrap();

        assert_eq!(response["language"], "Rust");
        assert_eq!(response["has_syntactic_changes"], true);
        assert_eq!(response["lhs"]["path"], "Pasted content");
        assert_eq!(response["rhs"]["path"], "Pasted content");
        assert!(response["diff"]["chunks"].is_array());
    }

    #[test]
    fn can_ignore_spaces_and_tabs_at_line_edges() {
        let response = visual_diff_inputs(
            VisualDiffInput::Text {
                name: "original.txt".to_owned(),
                content: "  alpha\t \n\tbeta  \n".to_owned(),
            },
            VisualDiffInput::Text {
                name: "changed.txt".to_owned(),
                content: "\talpha\n beta\t\t\n".to_owned(),
            },
            VisualDiffOptions {
                ignore_edge_whitespace: true,
                ..VisualDiffOptions::default()
            },
        )
        .unwrap();
        let response: serde_json::Value = serde_json::from_str(&response).unwrap();

        assert_eq!(response["has_syntactic_changes"], false);
        assert_eq!(response["lhs"]["content"], "  alpha\t \n\tbeta  \n");
        assert_eq!(response["rhs"]["content"], "\talpha\n beta\t\t\n");
    }

    #[test]
    fn edge_whitespace_option_keeps_internal_whitespace_meaningful() {
        let response = visual_diff_inputs(
            VisualDiffInput::Text {
                name: "original.txt".to_owned(),
                content: " alpha beta \n".to_owned(),
            },
            VisualDiffInput::Text {
                name: "changed.txt".to_owned(),
                content: "\talpha    beta\t\n".to_owned(),
            },
            VisualDiffOptions {
                ignore_edge_whitespace: true,
                ..VisualDiffOptions::default()
            },
        )
        .unwrap();
        let response: serde_json::Value = serde_json::from_str(&response).unwrap();

        assert_eq!(response["has_syntactic_changes"], true);
    }

    #[test]
    fn trims_line_edges_without_changing_line_endings() {
        assert_eq!(
            trim_line_edge_whitespace("  alpha \t\r\n\tbeta  \n"),
            "alpha\r\nbeta\n"
        );
    }

    #[test]
    fn remaps_trimmed_change_offsets_to_original_indentation() {
        let mut diff = serde_json::json!({
            "chunks": [[{
                "lhs": {
                    "line_number": 0,
                    "changes": [{ "start": 0, "end": 5 }]
                },
                "rhs": {
                    "line_number": 0,
                    "changes": [{ "start": 1, "end": 4 }]
                }
            }]]
        });

        shift_visual_change_offsets(&mut diff, "  alpha\n", "\talpha\n");

        assert_eq!(diff["chunks"][0][0]["lhs"]["changes"][0]["start"], 2);
        assert_eq!(diff["chunks"][0][0]["lhs"]["changes"][0]["end"], 7);
        assert_eq!(diff["chunks"][0][0]["rhs"]["changes"][0]["start"], 2);
        assert_eq!(diff["chunks"][0][0]["rhs"]["changes"][0]["end"], 5);
    }
}
