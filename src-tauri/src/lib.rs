mod commands;
mod jobs;

use commands::{
    check_media_tools, default_export_dir, extract_thumbnail, file_status, probe_media,
    read_text_file, register_asset_path, write_text_file,
};
use jobs::{cancel_job, start_concat, start_export, start_media_job, JobRegistry};

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
            start_export,
            start_concat,
            extract_thumbnail,
            default_export_dir,
            read_text_file,
            write_text_file,
            cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
