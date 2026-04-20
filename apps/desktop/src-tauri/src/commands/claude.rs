use semver::Version;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const CLAUDE_FLOOR: &str = "2.0.0";
const CLAUDE_CEIL_EXCLUSIVE: &str = "3.0.0";
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeState {
    Found,
    NotFound,
    BelowFloor,
    AboveCeiling,
    Unreadable,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub path: Option<String>,
    pub version: Option<String>,
    pub status: ClaudeState,
    pub floor: String,
    pub ceil_exclusive: String,
}

#[tauri::command]
pub async fn detect_claude() -> ClaudeStatus {
    let probe = resolve_claude_path().await;
    match probe {
        Some(path) => match read_version(&path).await {
            Some(v) => classify(&path, &v),
            None => ClaudeStatus {
                path: Some(path.display().to_string()),
                version: None,
                status: ClaudeState::Unreadable,
                floor: CLAUDE_FLOOR.into(),
                ceil_exclusive: CLAUDE_CEIL_EXCLUSIVE.into(),
            },
        },
        None => ClaudeStatus {
            path: None,
            version: None,
            status: ClaudeState::NotFound,
            floor: CLAUDE_FLOOR.into(),
            ceil_exclusive: CLAUDE_CEIL_EXCLUSIVE.into(),
        },
    }
}

pub async fn resolve_claude_path() -> Option<PathBuf> {
    if let Ok(envp) = std::env::var("OBELUS_CLAUDE_BIN") {
        let p = PathBuf::from(envp);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(p) = which::which("claude") {
        return Some(p);
    }
    if let Some(home) = dirs::home_dir() {
        for candidate in [
            home.join(".local/bin/claude"),
            home.join(".claude/bin/claude"),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

async fn read_version(path: &PathBuf) -> Option<String> {
    let fut = Command::new(path).arg("--version").output();
    let output = timeout(PROBE_TIMEOUT, fut).await.ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_version(&text)
}

fn parse_version(text: &str) -> Option<String> {
    // `claude --version` prints a line like "1.0.42 (Claude Code)" — grab the
    // first semver-shaped token.
    for token in text.split_whitespace() {
        if Version::parse(token).is_ok() {
            return Some(token.to_string());
        }
    }
    None
}

fn classify(path: &PathBuf, version: &str) -> ClaudeStatus {
    let parsed = Version::parse(version).ok();
    let state = match parsed {
        Some(v) => {
            let floor = Version::parse(CLAUDE_FLOOR).expect("valid floor");
            let ceil = Version::parse(CLAUDE_CEIL_EXCLUSIVE).expect("valid ceil");
            if v < floor {
                ClaudeState::BelowFloor
            } else if v >= ceil {
                ClaudeState::AboveCeiling
            } else {
                ClaudeState::Found
            }
        }
        None => ClaudeState::Unreadable,
    };
    ClaudeStatus {
        path: Some(path.display().to_string()),
        version: Some(version.to_string()),
        status: state,
        floor: CLAUDE_FLOOR.into(),
        ceil_exclusive: CLAUDE_CEIL_EXCLUSIVE.into(),
    }
}
