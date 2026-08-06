#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use difftastic::{visual_diff, VisualDiffOptions};

#[tauri::command(rename_all = "camelCase")]
fn compare_files(
    lhs_path: String,
    rhs_path: String,
    ignore_comments: bool,
    strip_cr: bool,
) -> Result<String, String> {
    visual_diff(
        lhs_path,
        rhs_path,
        VisualDiffOptions {
            ignore_comments,
            strip_cr,
        },
    )
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![compare_files])
        .run(tauri::generate_context!())
        .expect("error while running Difftastic Studio");
}
