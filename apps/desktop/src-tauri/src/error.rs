use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("path is not a descendant of any allowed project root")]
    OutOfScope,
    #[error("unknown project root id")]
    UnknownRootId,
    #[error("path is not a directory")]
    NotADirectory,
    #[error("file already exists")]
    AlreadyExists,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    // Phase 3 populates these via claude-sidecar and bundle-apply flows.
    #[allow(dead_code)]
    #[error("claude detection failed: {0}")]
    ClaudeDetect(String),
    #[error("apply failed: {0}")]
    Apply(String),
    #[allow(dead_code)]
    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
