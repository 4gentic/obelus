mod commands;
mod error;
mod migrations;
mod state;

use commands::{
    apply::apply_hunks,
    claude::detect_claude,
    claude_session::{
        claude_ask, claude_cancel, claude_draft_writeup, claude_fix_compile, claude_is_alive,
        claude_spawn, perf_log,
    },
    claude_user_settings::read_claude_user_settings,
    db_tx::db_tx_batch,
    dialog::{open_folder_picker, open_paper_picker, open_rubric_picker},
    engines::{engine_install, engine_list, engine_status, engine_uninstall},
    factory_reset::factory_reset,
    fs_scoped::{
        fs_create_file, fs_list_pdfs, fs_move_path, fs_read_dir, fs_read_file, fs_stat,
        fs_write_bytes, fs_write_text, fs_write_text_abs,
    },
    history::{
        history_checkout, history_detect_divergence, history_diff_manifests, history_gc,
        history_read_blob, history_snapshot,
    },
    latex::compile_latex,
    project::authorize_project_root,
    project_meta::project_scan,
    reset_local_state::reset_local_state,
    typst::compile_typst,
    workspace::{
        workspace_delete, workspace_path, workspace_read_dir, workspace_read_file,
        workspace_remove_paper_files, workspace_write_bytes, workspace_write_text,
    },
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
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            detect_claude,
            open_folder_picker,
            open_paper_picker,
            open_rubric_picker,
            authorize_project_root,
            fs_read_file,
            fs_read_dir,
            fs_write_bytes,
            fs_write_text,
            fs_write_text_abs,
            fs_create_file,
            fs_move_path,
            fs_list_pdfs,
            fs_stat,
            claude_spawn,
            claude_ask,
            claude_draft_writeup,
            claude_fix_compile,
            claude_cancel,
            claude_is_alive,
            perf_log,
            read_claude_user_settings,
            apply_hunks,
            compile_typst,
            compile_latex,
            engine_status,
            engine_list,
            engine_install,
            engine_uninstall,
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
            workspace_path,
            workspace_read_file,
            workspace_read_dir,
            workspace_write_text,
            workspace_write_bytes,
            workspace_delete,
            workspace_remove_paper_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obelus");
}
