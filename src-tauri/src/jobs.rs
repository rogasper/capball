use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub const JOB_EVENT: &str = "capball://job";

/// Child processes we can cancel, keyed by job id.
#[derive(Default)]
pub struct JobRegistry(pub Mutex<HashMap<String, Child>>);

/// How an imported file is prepared for playback.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobMode {
    /// Stream copy into MP4: lossless and fast, works when the codecs are supported.
    Remux,
    /// Re-encode: slower and lossy, the last resort for unsupported codecs.
    Transcode,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub job_id: String,
    pub kind: String,
    /// running | done | failed | cancelled
    pub state: String,
    pub out_time_ms: i64,
    pub total_ms: i64,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaJob {
    pub job_id: String,
    pub output: String,
    /// True when a previously prepared file was reused, so nothing was started.
    pub reused: bool,
}

fn next_job_id(kind: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{kind}-{nanos}")
}

fn emit(app: &AppHandle, event: JobEvent) {
    let _ = app.emit(JOB_EVENT, event);
}

/// FNV-1a over the path, size and mtime: a stable cache key for one source file.
pub(crate) fn fingerprint(path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |value: u64| {
        hash ^= value;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    };
    for byte in path.as_bytes() {
        mix(*byte as u64);
    }
    if let Ok(meta) = std::fs::metadata(path) {
        mix(meta.len());
        if let Ok(modified) = meta.modified() {
            if let Ok(since_epoch) = modified.duration_since(UNIX_EPOCH) {
                mix(since_epoch.as_nanos() as u64);
            }
        }
    }
    format!("{hash:016x}")
}

/// Prepared files live in the app cache directory, never beside the user's footage.
fn prepared_path(app: &AppHandle, input: &str) -> Result<PathBuf, String> {
    let dir = cache_dir(app)?.join("prepared");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(format!("{}.mp4", fingerprint(input))))
}

/// Everything derived from a source file lives here, never beside the footage.
pub(crate) fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("no cache directory available: {err}"))?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

fn ffmpeg_args(mode: JobMode, input: &str, output: &PathBuf) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        "-i".into(),
        input.into(),
    ];

    match mode {
        // Copying the streams is the right default: no quality loss and seconds,
        // not minutes, on a full match.
        JobMode::Remux => args.extend(["-c".into(), "copy".into()]),
        JobMode::Transcode => args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "20".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "160k".into(),
        ]),
    }

    args.extend(["-movflags".into(), "+faststart".into()]);
    args.push(output.to_string_lossy().to_string());
    args
}

#[tauri::command]
pub fn start_media_job(
    app: AppHandle,
    input: String,
    mode: JobMode,
    total_ms: i64,
) -> Result<MediaJob, String> {
    if !std::path::Path::new(&input).is_file() {
        return Err(format!("not a readable file: {input}"));
    }

    let output = prepared_path(&app, &input)?;
    let output_string = output.to_string_lossy().to_string();

    if output.is_file() && std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0) > 0 {
        return Ok(MediaJob {
            job_id: String::new(),
            output: output_string,
            reused: true,
        });
    }

    let kind = match mode {
        JobMode::Remux => "remux",
        JobMode::Transcode => "transcode",
    };
    let job_id = next_job_id(kind);
    let temp_path = output.with_extension("part.mp4");

    let mut child = Command::new("ffmpeg")
        .args(ffmpeg_args(mode, &input, &temp_path))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("ffmpeg could not be started: {err}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let registry = app.state::<JobRegistry>();
        let mut jobs = registry.0.lock().map_err(|err| err.to_string())?;
        jobs.insert(job_id.clone(), child);
    }

    emit(
        &app,
        JobEvent {
            job_id: job_id.clone(),
            kind: kind.into(),
            state: "running".into(),
            out_time_ms: 0,
            total_ms,
            message: None,
        },
    );

    // Drain stderr so a full pipe cannot stall the child; keep the tail for errors.
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = stderr {
        let tail = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut buffer) = tail.lock() {
                    buffer.push_str(&line);
                    buffer.push('\n');
                    let len = buffer.len();
                    if len > 2000 {
                        buffer.drain(..len - 2000);
                    }
                }
            }
        });
    }

    if let Some(stdout) = stdout {
        let progress_app = app.clone();
        let progress_job = job_id.clone();
        let progress_kind = kind.to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(value) = line.strip_prefix("out_time_ms=") {
                    if let Ok(micros) = value.trim().parse::<i64>() {
                        emit(
                            &progress_app,
                            JobEvent {
                                job_id: progress_job.clone(),
                                kind: progress_kind.clone(),
                                state: "running".into(),
                                out_time_ms: micros / 1000,
                                total_ms,
                                message: None,
                            },
                        );
                    }
                }
            }
        });
    }

    // Waiter: owns completion, cleanup and the final event.
    let wait_app = app.clone();
    let wait_job = job_id.clone();
    let wait_kind = kind.to_string();
    let wait_input = input.clone();
    std::thread::spawn(move || {
        let status = {
            let registry = wait_app.state::<JobRegistry>();
            let mut jobs = match registry.0.lock() {
                Ok(jobs) => jobs,
                Err(_) => return,
            };
            jobs.remove(&wait_job)
                .and_then(|mut child| child.wait().ok())
        };

        let stderr_message = stderr_tail
            .lock()
            .ok()
            .map(|buffer| buffer.trim().to_string())
            .filter(|text| !text.is_empty());

        match status {
            Some(status) if status.success() => {
                if let Err(err) = std::fs::rename(&temp_path, &output) {
                    let _ = std::fs::remove_file(&temp_path);
                    emit(
                        &wait_app,
                        JobEvent {
                            job_id: wait_job,
                            kind: wait_kind,
                            state: "failed".into(),
                            out_time_ms: 0,
                            total_ms,
                            message: Some(format!("could not finalise output: {err}")),
                        },
                    );
                    return;
                }
                emit(
                    &wait_app,
                    JobEvent {
                        job_id: wait_job,
                        kind: wait_kind,
                        state: "done".into(),
                        out_time_ms: total_ms,
                        total_ms,
                        message: None,
                    },
                );
            }
            // Non-zero exit: ffmpeg refused the file or died mid-run.
            Some(_) => {
                let _ = std::fs::remove_file(&temp_path);
                emit(
                    &wait_app,
                    JobEvent {
                        job_id: wait_job,
                        kind: wait_kind,
                        state: "failed".into(),
                        out_time_ms: 0,
                        total_ms,
                        message: stderr_message
                            .or_else(|| Some(format!("ffmpeg could not prepare {wait_input}"))),
                    },
                );
            }
            // No child in the registry: cancel_job took it, so this was cancelled.
            None => {
                let _ = std::fs::remove_file(&temp_path);
                emit(
                    &wait_app,
                    JobEvent {
                        job_id: wait_job,
                        kind: wait_kind,
                        state: "cancelled".into(),
                        out_time_ms: 0,
                        total_ms,
                        message: None,
                    },
                );
            }
        }
    });

    Ok(MediaJob {
        job_id,
        output: output_string,
        reused: false,
    })
}

#[tauri::command]
pub fn cancel_job(app: AppHandle, job_id: String) -> Result<(), String> {
    let registry = app.state::<JobRegistry>();
    let mut jobs = registry.0.lock().map_err(|err| err.to_string())?;
    if let Some(child) = jobs.get_mut(&job_id) {
        child.kill().map_err(|err| err.to_string())?;
    }
    jobs.remove(&job_id);
    Ok(())
}
