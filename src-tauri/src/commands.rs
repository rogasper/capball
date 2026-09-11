use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

/// Whether the external media tools are available, and which version.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub ffmpeg: bool,
    pub ffprobe: bool,
    pub ffmpeg_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub exists: bool,
    pub size_bytes: Option<u64>,
}

/// Everything the app needs to know about an imported video.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub path: String,
    pub size_bytes: u64,
    pub container: Option<String>,
    pub duration_ms: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps_num: Option<u32>,
    pub fps_den: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
}

fn tool_version(name: &str) -> Option<String> {
    let output = Command::new(name).arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|line| line.trim().to_string())
}

#[tauri::command]
pub fn check_media_tools() -> ToolStatus {
    let ffmpeg = tool_version("ffmpeg");
    ToolStatus {
        ffmpeg: ffmpeg.is_some(),
        ffprobe: tool_version("ffprobe").is_some(),
        ffmpeg_version: ffmpeg,
    }
}

#[tauri::command]
pub fn file_status(path: String) -> FileStatus {
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_file() => FileStatus {
            exists: true,
            size_bytes: Some(meta.len()),
        },
        _ => FileStatus {
            exists: false,
            size_bytes: None,
        },
    }
}

/// Grant a single user-chosen file to the asset protocol.
///
/// The scope stays empty in configuration, so nothing is readable until the
/// user picks it; `$HOME/**` is deliberately never granted.
#[tauri::command]
pub fn register_asset_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri::Manager;

    let candidate = PathBuf::from(&path);
    if !candidate.is_file() {
        return Err(format!("not a readable file: {path}"));
    }
    app.asset_protocol_scope()
        .allow_file(&candidate)
        .map_err(|err| err.to_string())
}

fn parse_rational(value: &str) -> Option<(u32, u32)> {
    let (num, den) = value.split_once('/')?;
    let num: u32 = num.trim().parse().ok()?;
    let den: u32 = den.trim().parse().ok()?;
    if den == 0 {
        None
    } else {
        Some((num, den))
    }
}

#[tauri::command]
pub fn probe_media(path: String) -> Result<MediaProbe, String> {
    let size_bytes = std::fs::metadata(&path)
        .map_err(|err| format!("cannot read {path}: {err}"))?
        .len();

    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|err| format!("ffprobe could not be started: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr.trim()));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("ffprobe returned unreadable output: {err}"))?;

    let container = json
        .get("format")
        .and_then(|f| f.get("format_name"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let duration_ms = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .map(|secs| (secs * 1000.0).round() as i64)
        .unwrap_or(0);

    let streams = json
        .get("streams")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"));
    let audio = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));

    let frame_rate = video
        .and_then(|s| s.get("avg_frame_rate").and_then(|v| v.as_str()))
        .filter(|s| *s != "0/0")
        .or_else(|| {
            video.and_then(|s| s.get("r_frame_rate").and_then(|v| v.as_str()))
        })
        .and_then(parse_rational);

    Ok(MediaProbe {
        path,
        size_bytes,
        container,
        duration_ms,
        width: video
            .and_then(|s| s.get("width"))
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        height: video
            .and_then(|s| s.get("height"))
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        fps_num: frame_rate.map(|(num, _)| num),
        fps_den: frame_rate.map(|(_, den)| den),
        video_codec: video
            .and_then(|s| s.get("codec_name"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        audio_codec: audio
            .and_then(|s| s.get("codec_name"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}
