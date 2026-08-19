#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use difftastic::{visual_diff_inputs, VisualDiffInput, VisualDiffOptions};

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum DiffInput {
    File { path: String },
    Text { name: String, content: String },
}

impl From<DiffInput> for VisualDiffInput {
    fn from(input: DiffInput) -> Self {
        match input {
            DiffInput::File { path } => Self::File(path.into()),
            DiffInput::Text { name, content } => Self::Text { name, content },
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
fn compare_inputs(
    lhs: DiffInput,
    rhs: DiffInput,
    ignore_comments: bool,
    ignore_edge_whitespace: bool,
    strip_cr: bool,
) -> Result<String, String> {
    visual_diff_inputs(
        lhs.into(),
        rhs.into(),
        VisualDiffOptions {
            ignore_comments,
            ignore_edge_whitespace,
            strip_cr,
        },
    )
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![compare_inputs])
        .run(tauri::generate_context!())
        .expect("error while running Difftacular");
}
