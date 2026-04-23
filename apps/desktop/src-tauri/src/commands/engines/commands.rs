// IPC surface for the managed-engines flow.
//
// engine_status / engine_list probe the host for a managed or PATH install,
// run the binary under a short timeout to read its version, and return a
// serializable status row the wizard and settings screen render directly.
//
// engine_install streams a pinned release archive into a staging dir,
// verifies sha256 (when the manifest pins one), extracts the single binary,
// and moves it into place — emitting engine:progress events so the UI can
// show a live progress bar.

use semver::Version;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;
use tokio::process::Command;
use tokio::time::timeout;

use super::download::{self, ProgressEvent, Stage};
use super::extract;
use super::manifest::{
    binary_filename, for_current_platform, ArchiveKind, EngineName, ManifestEntry,
    TECTONIC_VERSION, TYPST_VERSION,
};
use super::resolver::{managed_binary_path, managed_dir, path_lookup};
use super::verify;
use crate::error::{AppError, AppResult};

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EngineKind {
    Managed,
    System,
    None,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub engine: &'static str,
    pub kind: EngineKind,
    pub path: Option<String>,
    pub version: Option<String>,
    pub available_version: &'static str,
    pub platform_supported: bool,
}

#[tauri::command]
pub async fn engine_status(app: AppHandle, name: String) -> AppResult<EngineStatus> {
    let engine = EngineName::from_str(&name)
        .ok_or_else(|| AppError::Other(format!("unknown engine: {name}")))?;
    Ok(probe(&app, engine).await)
}

#[tauri::command]
pub async fn engine_list(app: AppHandle) -> AppResult<Vec<EngineStatus>> {
    Ok(vec![
        probe(&app, EngineName::Typst).await,
        probe(&app, EngineName::Tectonic).await,
    ])
}

async fn probe(app: &AppHandle, engine: EngineName) -> EngineStatus {
    let stem = engine.as_str();
    let platform_supported = for_current_platform(engine).is_some();
    let available = match engine {
        EngineName::Typst => TYPST_VERSION,
        EngineName::Tectonic => TECTONIC_VERSION,
    };
    let (kind, path): (EngineKind, Option<PathBuf>) = match managed_binary_path(app, stem) {
        Ok(managed) if managed.exists() => (EngineKind::Managed, Some(managed)),
        _ => match path_lookup(stem) {
            Some(p) => (EngineKind::System, Some(p)),
            None => (EngineKind::None, None),
        },
    };
    let version = match &path {
        Some(p) => read_version(p).await,
        None => None,
    };
    EngineStatus {
        engine: stem,
        kind,
        path: path.as_ref().map(|p| p.display().to_string()),
        version,
        available_version: available,
        platform_supported,
    }
}

async fn read_version(path: &PathBuf) -> Option<String> {
    let fut = Command::new(path).arg("--version").output();
    let output = timeout(PROBE_TIMEOUT, fut).await.ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let combined = if text.trim().is_empty() {
        String::from_utf8_lossy(&output.stderr).into_owned()
    } else {
        text.into_owned()
    };
    parse_version(&combined)
}

fn parse_version(text: &str) -> Option<String> {
    for raw in text.split(|c: char| c.is_whitespace() || c == ',') {
        let cleaned = raw.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.');
        if Version::parse(cleaned).is_ok() {
            return Some(cleaned.to_string());
        }
    }
    None
}

#[tauri::command]
pub async fn engine_install(app: AppHandle, name: String) -> AppResult<()> {
    let engine = EngineName::from_str(&name)
        .ok_or_else(|| AppError::Other(format!("unknown engine: {name}")))?;
    let entry = for_current_platform(engine).ok_or_else(|| {
        AppError::Other("managed install is not available on this platform".into())
    })?;
    let label = name.clone();
    match install_inner(&app, &entry, &label).await {
        Ok(()) => {
            download::emit(
                &app,
                ProgressEvent {
                    engine: label,
                    stage: Stage::Done,
                    bytes_done: None,
                    bytes_total: None,
                    message: None,
                },
            );
            Ok(())
        }
        Err(err) => {
            download::emit(
                &app,
                ProgressEvent {
                    engine: label,
                    stage: Stage::Error,
                    bytes_done: None,
                    bytes_total: None,
                    message: Some(err.to_string()),
                },
            );
            Err(err)
        }
    }
}

async fn install_inner(app: &AppHandle, entry: &ManifestEntry, label: &str) -> AppResult<()> {
    let bin_dir = managed_dir(app)?;
    let staging = bin_dir.join("staging");
    tokio::fs::create_dir_all(&staging)
        .await
        .map_err(AppError::from)?;

    let archive_name = archive_filename(entry);
    let archive_path = staging.join(&archive_name);
    let _ = tokio::fs::remove_file(&archive_path).await;

    download::download_to(app, label, &entry.url, &archive_path).await?;

    download::emit(
        app,
        ProgressEvent {
            engine: label.to_string(),
            stage: Stage::Verifying,
            bytes_done: None,
            bytes_total: None,
            message: None,
        },
    );
    verify::verify(&archive_path, entry.sha256).await?;

    download::emit(
        app,
        ProgressEvent {
            engine: label.to_string(),
            stage: Stage::Extracting,
            bytes_done: None,
            bytes_total: None,
            message: None,
        },
    );

    let final_path = bin_dir.join(binary_filename(entry.engine.as_str()));
    let inner_path = entry.inner_path.clone();
    let archive_kind = entry.archive;
    let archive_path_for_blocking = archive_path.clone();
    let final_path_for_blocking = final_path.clone();
    tokio::task::spawn_blocking(move || {
        extract::extract_binary(
            &archive_path_for_blocking,
            archive_kind,
            &inner_path,
            &final_path_for_blocking,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("extract join: {e}")))??;

    let _ = tokio::fs::remove_file(&archive_path).await;

    Ok(())
}

fn archive_filename(entry: &ManifestEntry) -> String {
    let ext = match entry.archive {
        ArchiveKind::TarXz => "tar.xz",
        ArchiveKind::TarGz => "tar.gz",
        ArchiveKind::Zip => "zip",
    };
    format!("{}-{}.{}", entry.engine.as_str(), entry.version, ext)
}

#[tauri::command]
pub async fn engine_uninstall(app: AppHandle, name: String) -> AppResult<()> {
    let engine = EngineName::from_str(&name)
        .ok_or_else(|| AppError::Other(format!("unknown engine: {name}")))?;
    let path = managed_binary_path(&app, engine.as_str())?;
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::Other(format!(
            "failed to remove {}: {err}",
            path.display()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_typst_version_string() {
        assert_eq!(parse_version("typst 0.14.2 (abc123)"), Some("0.14.2".into()));
    }

    #[test]
    fn parse_tectonic_version_string() {
        assert_eq!(parse_version("Tectonic 0.16.9\n"), Some("0.16.9".into()));
    }

    #[test]
    fn parse_version_returns_none_without_semver() {
        assert_eq!(parse_version("no version here"), None);
    }

    #[test]
    fn archive_filename_matches_extension() {
        let entry = super::super::manifest::for_current_platform(EngineName::Typst);
        if let Some(e) = entry {
            let name = archive_filename(&e);
            assert!(name.starts_with("typst-"));
            assert!(name.ends_with(".tar.xz") || name.ends_with(".zip"));
        }
    }
}
