use std::io::{Read, Seek, SeekFrom};
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
    /// None when it does not apply (not an ISO-BMFF container) or is unknown.
    pub faststart: Option<bool>,
}

/// Top-level atoms we expect to meet while walking an ISO-BMFF file.
const MP4_ATOMS: [&[u8; 4]; 8] = [
    b"ftyp", b"styp", b"moov", b"mdat", b"free", b"skip", b"wide", b"pnot",
];

/// Bound on how far into a file we look before giving up.
const MAX_ATOMS: usize = 64;

/// Walks the top-level atoms of an ISO-BMFF file to find whether the index
/// (`moov`) comes before the media data (`mdat`).
///
/// With the index at the end, a player must read the tail of the file before it
/// can seek anywhere, which is slow over a protocol that serves 1 MB ranges.
/// Bounded to a handful of atoms, and it seeks over `mdat` rather than reading
/// it, so this costs a few hundred bytes regardless of file size.
fn faststart_in<R: Read + Seek>(reader: &mut R, total: u64) -> Option<bool> {
    let mut offset: u64 = 0;

    for index in 0..MAX_ATOMS {
        if offset + 8 > total {
            return None;
        }

        reader.seek(SeekFrom::Start(offset)).ok()?;
        let mut header = [0u8; 8];
        reader.read_exact(&mut header).ok()?;

        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let kind: [u8; 4] = [header[4], header[5], header[6], header[7]];

        // A file that does not start with a known atom is not ISO-BMFF.
        if index == 0 && !MP4_ATOMS.iter().any(|known| **known == kind) {
            return None;
        }

        let size = match size32 {
            0 => total - offset,
            1 => {
                let mut wide = [0u8; 8];
                reader.read_exact(&mut wide).ok()?;
                u64::from_be_bytes(wide)
            }
            other => other as u64,
        };

        if size < 8 {
            return None;
        }

        if &kind == b"moov" {
            return Some(true);
        }
        if &kind == b"mdat" {
            return Some(false);
        }

        offset = offset.checked_add(size)?;
    }

    None
}

fn mp4_faststart(path: &std::path::Path) -> Option<bool> {
    let mut file = std::fs::File::open(path).ok()?;
    let total = file.metadata().ok()?.len();
    faststart_in(&mut file, total)
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
        .or_else(|| video.and_then(|s| s.get("r_frame_rate").and_then(|v| v.as_str())))
        .and_then(parse_rational);

    // Only ISO-BMFF containers have a moov/mdat ordering to care about.
    let faststart = match container.as_deref() {
        Some(name) if name.contains("mp4") || name.contains("mov") => {
            mp4_faststart(std::path::Path::new(&path))
        }
        _ => None,
    };

    Ok(MediaProbe {
        path,
        size_bytes,
        container,
        duration_ms,
        faststart,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A regular 32-bit ISO-BMFF atom.
    fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&((payload.len() + 8) as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    /// An atom using the 64-bit size form (size field == 1).
    fn atom64(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&1u32.to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(&((payload.len() + 16) as u64).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    /// An atom whose size field is 0, meaning it runs to the end of the file.
    fn atom_to_eof(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    fn reader(atoms: &[Vec<u8>]) -> (Cursor<Vec<u8>>, u64) {
        let mut bytes = Vec::new();
        for atom in atoms {
            bytes.extend_from_slice(atom);
        }
        let total = bytes.len() as u64;
        (Cursor::new(bytes), total)
    }

    #[test]
    fn index_before_media_data_is_faststart() {
        let (mut cursor, total) = reader(&[
            atom(b"ftyp", &[0; 16]),
            atom(b"moov", &[0; 32]),
            atom(b"mdat", &[0; 4096]),
        ]);
        assert_eq!(faststart_in(&mut cursor, total), Some(true));
    }

    #[test]
    fn index_after_media_data_is_not_faststart() {
        // This is the shape that makes seeking slow: 536 MB of media, then the index.
        let (mut cursor, total) = reader(&[
            atom(b"ftyp", &[0; 16]),
            atom(b"mdat", &[0; 65536]),
            atom(b"moov", &[0; 512]),
        ]);
        assert_eq!(faststart_in(&mut cursor, total), Some(false));
    }

    #[test]
    fn walks_past_other_header_atoms() {
        let (mut cursor, total) = reader(&[
            atom(b"ftyp", &[0; 16]),
            atom(b"free", &[0; 8]),
            atom(b"wide", &[0; 8]),
            atom(b"moov", &[0; 16]),
        ]);
        assert_eq!(faststart_in(&mut cursor, total), Some(true));
    }

    #[test]
    fn understands_the_sixty_four_bit_size_form() {
        let (mut cursor, total) = reader(&[atom(b"ftyp", &[0; 16]), atom64(b"moov", &[0; 32])]);
        assert_eq!(faststart_in(&mut cursor, total), Some(true));
    }

    #[test]
    fn understands_an_atom_that_runs_to_the_end_of_the_file() {
        let (mut cursor, total) =
            reader(&[atom(b"ftyp", &[0; 16]), atom_to_eof(b"free", &[0; 32])]);
        // The trailing atom consumes the rest, so no index or media data is found.
        assert_eq!(faststart_in(&mut cursor, total), None);
    }

    #[test]
    fn refuses_files_that_are_not_iso_bmff() {
        let (mut cursor, total) = reader(&[atom(b"zzzz", &[0; 16])]);
        assert_eq!(faststart_in(&mut cursor, total), None);
    }

    #[test]
    fn refuses_a_truncated_header() {
        let bytes = vec![0u8; 4];
        let total = bytes.len() as u64;
        assert_eq!(faststart_in(&mut Cursor::new(bytes), total), None);
    }

    #[test]
    fn gives_up_after_the_atom_bound() {
        let mut atoms = vec![atom(b"ftyp", &[0; 16])];
        for _ in 0..MAX_ATOMS + 5 {
            atoms.push(atom(b"free", &[0; 8]));
        }
        let (mut cursor, total) = reader(&atoms);
        assert_eq!(faststart_in(&mut cursor, total), None);
    }

    #[test]
    fn refuses_an_impossible_atom_size() {
        // A size smaller than the header itself can only be corruption.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&4u32.to_be_bytes());
        bytes.extend_from_slice(b"ftyp");
        let total = bytes.len() as u64;
        assert_eq!(faststart_in(&mut Cursor::new(bytes), total), None);
    }
}

/// Renders one frame to a cached JPEG and grants it to the asset protocol.
///
/// The path is keyed by the source fingerprint and the timestamp, so a given
/// moment is rendered once per file and reused afterwards (FR-12).
#[tauri::command]
pub fn extract_thumbnail(
    app: tauri::AppHandle,
    input: String,
    at_ms: i64,
) -> Result<String, String> {
    use tauri::Manager;

    if !std::path::Path::new(&input).is_file() {
        return Err(format!("not a readable file: {input}"));
    }

    let dir = crate::jobs::cache_dir(&app)?.join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    let at_ms = at_ms.max(0);
    let out = dir.join(format!("{}-{at_ms}.jpg", crate::jobs::fingerprint(&input)));
    let already_rendered = out.is_file() && std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0) > 0;

    if !already_rendered {
        let seconds = format!("{:.3}", at_ms as f64 / 1000.0);
        let status = Command::new("ffmpeg")
            .args([
                "-y",
                "-nostdin",
                "-loglevel",
                "error",
                "-ss",
                &seconds,
                "-i",
                &input,
                "-frames:v",
                "1",
                "-vf",
                "scale=320:-2",
                "-q:v",
                "4",
            ])
            .arg(&out)
            .status()
            .map_err(|err| format!("ffmpeg could not be started: {err}"))?;

        if !status.success() {
            // Never leave a zero-byte file behind pretending to be a thumbnail.
            let _ = std::fs::remove_file(&out);
            return Err("could not render a thumbnail for that moment".into());
        }
    }

    app.asset_protocol_scope()
        .allow_file(&out)
        .map_err(|err| err.to_string())?;

    Ok(out.to_string_lossy().to_string())
}
