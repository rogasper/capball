use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
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

/// How a clip is cut (FR-9.3).
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportMode {
    /// Stream copy from the nearest keyframe: seconds per clip, but the cut can
    /// start slightly before the requested moment.
    Fast,
    /// Re-encode: slower, and the cut lands exactly where it was asked to.
    Accurate,
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

/// One FFmpeg run: what to execute, where the result lands, and how to clean up.
struct JobSpec {
    kind: String,
    args: Vec<String>,
    /// Written by ffmpeg, then renamed into place so a failure never leaves a
    /// file that looks finished.
    temp_path: PathBuf,
    final_path: PathBuf,
    total_ms: i64,
    /// Used in the failure message, so it names what the user asked for.
    subject: String,
    /// Exports must never replace an existing file (FR-9.4).
    refuse_overwrite: bool,
    /// Scratch files to remove once the job is over.
    cleanup: Vec<PathBuf>,
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

fn emit_state(app: &AppHandle, job_id: &str, kind: &str, state: &str, total_ms: i64, message: Option<String>) {
    emit(
        app,
        JobEvent {
            job_id: job_id.to_string(),
            kind: kind.to_string(),
            state: state.to_string(),
            out_time_ms: if state == "done" { total_ms } else { 0 },
            total_ms,
            message,
        },
    );
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

/// Everything derived from a source file lives here, never beside the footage.
pub(crate) fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("no cache directory available: {err}"))?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

fn prepared_path(app: &AppHandle, input: &str) -> Result<PathBuf, String> {
    let dir = cache_dir(app)?.join("prepared");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(format!("{}.mp4", fingerprint(input))))
}

fn file_is_non_empty(path: &std::path::Path) -> bool {
    std::fs::metadata(path).map(|meta| meta.len() > 0).unwrap_or(false)
}

/// Shared prefix for every job: quiet, machine-readable progress, no prompts.
fn base_args() -> Vec<String> {
    [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
    ]
    .iter()
    .map(|value| (*value).to_string())
    .collect()
}

fn seconds(ms: i64) -> String {
    format!("{:.3}", ms.max(0) as f64 / 1000.0)
}

fn run_job(app: &AppHandle, spec: JobSpec) -> Result<MediaJob, String> {
    let JobSpec {
        kind,
        args,
        temp_path,
        final_path,
        total_ms,
        subject,
        refuse_overwrite,
        cleanup,
    } = spec;

    let mut child = Command::new("ffmpeg")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("ffmpeg could not be started: {err}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let job_id = next_job_id(&kind);

    {
        let registry = app.state::<JobRegistry>();
        let mut jobs = registry.0.lock().map_err(|err| err.to_string())?;
        jobs.insert(job_id.clone(), child);
    }

    emit_state(app, &job_id, &kind, "running", total_ms, None);

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
        let progress_kind = kind.clone();
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
    let output_string = final_path.to_string_lossy().to_string();
    let wait_app = app.clone();
    let wait_job = job_id.clone();
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

        for scratch in &cleanup {
            let _ = std::fs::remove_file(scratch);
        }

        let stderr_message = stderr_tail
            .lock()
            .ok()
            .map(|buffer| buffer.trim().to_string())
            .filter(|text| !text.is_empty());

        match status {
            Some(status) if status.success() => {
                if refuse_overwrite && final_path.exists() {
                    let _ = std::fs::remove_file(&temp_path);
                    emit_state(
                        &wait_app,
                        &wait_job,
                        &kind,
                        "failed",
                        total_ms,
                        Some(format!("{subject} already exists; nothing was replaced")),
                    );
                    return;
                }

                if let Err(err) = std::fs::rename(&temp_path, &final_path) {
                    let _ = std::fs::remove_file(&temp_path);
                    emit_state(
                        &wait_app,
                        &wait_job,
                        &kind,
                        "failed",
                        total_ms,
                        Some(format!("could not finalise output: {err}")),
                    );
                    return;
                }

                emit_state(&wait_app, &wait_job, &kind, "done", total_ms, None);
            }
            // Non-zero exit: ffmpeg refused the file or died mid-run.
            Some(_) => {
                let _ = std::fs::remove_file(&temp_path);
                emit_state(
                    &wait_app,
                    &wait_job,
                    &kind,
                    "failed",
                    total_ms,
                    stderr_message.or_else(|| Some(format!("ffmpeg could not process {subject}"))),
                );
            }
            // No child in the registry: cancel_job took it, so this was cancelled.
            None => {
                let _ = std::fs::remove_file(&temp_path);
                emit_state(&wait_app, &wait_job, &kind, "cancelled", total_ms, None);
            }
        }
    });

    Ok(MediaJob {
        job_id,
        output: output_string,
        reused: false,
    })
}

/// Prepares an imported file for playback, reusing a copy that already exists.
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

    if file_is_non_empty(&output) {
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

    let mut args = base_args();
    args.extend(["-i".to_string(), input.clone()]);
    match mode {
        // Copying the streams is the right default: no quality loss and seconds,
        // not minutes, on a full match.
        JobMode::Remux => args.extend(["-c".to_string(), "copy".to_string()]),
        JobMode::Transcode => args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
            ]
            .iter()
            .map(|value| (*value).to_string()),
        ),
    }
    args.extend(["-movflags".to_string(), "+faststart".to_string()]);

    let temp_path = output.with_extension("part.mp4");
    args.push(temp_path.to_string_lossy().to_string());

    run_job(
        &app,
        JobSpec {
            kind: kind.to_string(),
            args,
            temp_path,
            final_path: output,
            total_ms,
            subject: input,
            refuse_overwrite: false,
            cleanup: Vec::new(),
        },
    )
}

/// Cuts one clip to a destination the user chose (FR-9.1, FR-9.3).
#[tauri::command]
pub fn start_export(
    app: AppHandle,
    input: String,
    output: String,
    start_ms: i64,
    end_ms: i64,
    mode: ExportMode,
) -> Result<MediaJob, String> {
    if !std::path::Path::new(&input).is_file() {
        return Err(format!("not a readable file: {input}"));
    }

    let final_path = PathBuf::from(&output);
    if final_path.exists() {
        return Err(format!("{output} already exists; nothing was replaced"));
    }
    if let Some(parent) = final_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let duration_ms = end_ms.saturating_sub(start_ms);
    if duration_ms <= 0 {
        return Err("that clip has no length".to_string());
    }

    let mut args = base_args();
    // Seeking before the input is the fast path; with a re-encode it is also
    // frame-accurate, because ffmpeg discards the frames before the target.
    args.extend(["-ss".to_string(), seconds(start_ms)]);
    args.extend(["-i".to_string(), input.clone()]);
    args.extend(["-t".to_string(), seconds(duration_ms)]);

    match mode {
        ExportMode::Fast => args.extend(
            ["-c", "copy", "-avoid_negative_ts", "make_zero"]
                .iter()
                .map(|value| (*value).to_string()),
        ),
        ExportMode::Accurate => args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
            ]
            .iter()
            .map(|value| (*value).to_string()),
        ),
    }
    args.extend(["-movflags".to_string(), "+faststart".to_string()]);

    let temp_path = final_path.with_extension("part.mp4");
    args.push(temp_path.to_string_lossy().to_string());

    run_job(
        &app,
        JobSpec {
            kind: "export".to_string(),
            args,
            temp_path,
            final_path,
            total_ms: duration_ms,
            subject: output,
            refuse_overwrite: true,
            cleanup: Vec::new(),
        },
    )
}

/// Joins already-rendered clips into one file, in the order given (FR-9.2).
#[tauri::command]
pub fn start_concat(
    app: AppHandle,
    inputs: Vec<String>,
    output: String,
    total_ms: i64,
) -> Result<MediaJob, String> {
    if inputs.is_empty() {
        return Err("nothing to join".to_string());
    }
    for input in &inputs {
        if !std::path::Path::new(input).is_file() {
            return Err(format!("not a readable file: {input}"));
        }
    }

    let final_path = PathBuf::from(&output);
    if final_path.exists() {
        return Err(format!("{output} already exists; nothing was replaced"));
    }
    if let Some(parent) = final_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    // The concat demuxer reads a list file. Single quotes are escaped the way
    // ffmpeg's own parser expects.
    let list_dir = cache_dir(&app)?.join("concat");
    std::fs::create_dir_all(&list_dir).map_err(|err| err.to_string())?;
    let list_path = list_dir.join(format!("{}.txt", next_job_id("list")));

    let mut list = std::fs::File::create(&list_path).map_err(|err| err.to_string())?;
    for input in &inputs {
        let escaped = input.replace('\'', r"'\''");
        writeln!(list, "file '{escaped}'").map_err(|err| err.to_string())?;
    }
    drop(list);

    let mut args = base_args();
    args.extend([
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        list_path.to_string_lossy().to_string(),
    ]);
    // Every clip came from the same source with the same settings, so the join
    // itself is a stream copy.
    args.extend(["-c".to_string(), "copy".to_string()]);
    args.extend(["-movflags".to_string(), "+faststart".to_string()]);

    let temp_path = final_path.with_extension("part.mp4");
    args.push(temp_path.to_string_lossy().to_string());

    run_job(
        &app,
        JobSpec {
            kind: "concat".to_string(),
            args,
            temp_path,
            final_path,
            total_ms,
            subject: output,
            refuse_overwrite: true,
            cleanup: vec![list_path],
        },
    )
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
