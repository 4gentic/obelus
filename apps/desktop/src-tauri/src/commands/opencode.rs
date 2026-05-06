use crate::commands::claude::HostOs;
use semver::Version;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum OpenCodeState {
    Found,
    NotFound,
    Unreadable,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeStatus {
    pub path: Option<String>,
    pub version: Option<String>,
    pub status: OpenCodeState,
    pub host_os: HostOs,
}

#[tauri::command]
pub async fn detect_opencode() -> OpenCodeStatus {
    let probe = resolve_opencode_path().await;
    match probe {
        Some(path) => match read_version(&path).await {
            Some(v) => OpenCodeStatus {
                path: Some(path.display().to_string()),
                version: Some(v),
                status: OpenCodeState::Found,
                host_os: HostOs::current(),
            },
            None => OpenCodeStatus {
                path: Some(path.display().to_string()),
                version: None,
                status: OpenCodeState::Unreadable,
                host_os: HostOs::current(),
            },
        },
        None => OpenCodeStatus {
            path: None,
            version: None,
            status: OpenCodeState::NotFound,
            host_os: HostOs::current(),
        },
    }
}

pub async fn resolve_opencode_path() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Ok(envp) = std::env::var("OBELUS_OPENCODE_BIN") {
        let p = PathBuf::from(envp);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(p) = which::which("opencode") {
        return Some(p);
    }
    if let Some(home) = dirs::home_dir() {
        for candidate in [
            home.join(".opencode/bin/opencode"),
            home.join(".local/bin/opencode"),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

async fn read_version(path: &Path) -> Option<String> {
    let fut = Command::new(path).arg("--version").output();
    let output = timeout(PROBE_TIMEOUT, fut).await.ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_version(&text)
}

fn parse_version(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        if Version::parse(token).is_ok() {
            return Some(token.to_string());
        }
    }
    None
}
