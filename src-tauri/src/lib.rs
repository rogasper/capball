mod commands;
mod jobs;

use commands::{check_media_tools, file_status, probe_media, register_asset_path};
use jobs::{cancel_job, start_media_job, JobRegistry};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            register_asset_path,
            check_media_tools,
            file_status,
            probe_media,
            start_media_job,
            cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
