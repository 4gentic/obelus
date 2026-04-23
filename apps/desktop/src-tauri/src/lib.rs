mod commands;
mod error;
mod migrations;
mod state;

use commands::{
    apply::apply_hunks,
    claude::detect_claude,
    claude_session::{claude_ask, claude_cancel, claude_draft_writeup, claude_spawn},
    claude_user_settings::read_claude_user_settings,
    db_tx::db_tx_batch,
    dialog::{open_folder_picker, open_pdf_picker, open_rubric_picker},
    factory_reset::factory_reset,
    fs_scoped::{
        fs_create_file, fs_list_pdfs, fs_read_dir, fs_read_file, fs_stat, fs_write_bytes,
        fs_write_text, fs_write_text_abs,
    },
    history::{
        history_checkout, history_detect_divergence, history_diff_manifests, history_gc,
        history_read_blob, history_snapshot,
    },
    project::authorize_project_root,
    project_meta::project_scan,
    reset_local_state::reset_local_state,
    typst::compile_typst,
};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:obelus.db", migrations::all())
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            detect_claude,
            open_folder_picker,
            open_pdf_picker,
            open_rubric_picker,
            authorize_project_root,
            fs_read_file,
            fs_read_dir,
            fs_write_bytes,
            fs_write_text,
            fs_write_text_abs,
            fs_create_file,
            fs_list_pdfs,
            fs_stat,
            claude_spawn,
            claude_ask,
            claude_draft_writeup,
            claude_cancel,
            read_claude_user_settings,
            apply_hunks,
            compile_typst,
            db_tx_batch,
            history_snapshot,
            history_detect_divergence,
            history_checkout,
            history_gc,
            history_read_blob,
            history_diff_manifests,
            project_scan,
            reset_local_state,
            factory_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obelus");
}
