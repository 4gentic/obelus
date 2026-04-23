// Streams a release archive from GitHub into a temp file, emitting progress
// events the settings / wizard UI can hang a progress bar on. Zero buffering
// of the whole tarball — we chunk into the writer as the stream yields.

use futures_util::StreamExt;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};

pub const EVENT_NAME: &str = "engine:progress";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub engine: String,
    pub stage: Stage,
    pub bytes_done: Option<u64>,
    pub bytes_total: Option<u64>,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Downloading,
    Verifying,
    Extracting,
    Done,
    Error,
}

pub fn emit(app: &AppHandle, event: ProgressEvent) {
    // Best-effort: if the UI window has closed we don't care.
    let _ = app.emit(EVENT_NAME, event);
}

pub async fn download_to(
    app: &AppHandle,
    engine_label: &str,
    url: &str,
    dest: &Path,
) -> AppResult<()> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("obelus-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("GET {url}: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "GET {url} returned {}",
            resp.status()
        )));
    }

    let total = resp.content_length();
    let mut stream = resp.bytes_stream();
    let mut file = File::create(dest).await.map_err(AppError::from)?;
    let mut bytes_done: u64 = 0;
    let mut last_emit_at: u64 = 0;

    // Emit an initial 0/total tick so the UI can draw a progress bar before
    // the first chunk lands.
    emit(
        app,
        ProgressEvent {
            engine: engine_label.to_string(),
            stage: Stage::Downloading,
            bytes_done: Some(0),
            bytes_total: total,
            message: None,
        },
    );

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Other(format!("chunk: {e}")))?;
        file.write_all(&chunk).await.map_err(AppError::from)?;
        bytes_done += chunk.len() as u64;
        if bytes_done - last_emit_at >= 64 * 1024 {
            emit(
                app,
                ProgressEvent {
                    engine: engine_label.to_string(),
                    stage: Stage::Downloading,
                    bytes_done: Some(bytes_done),
                    bytes_total: total,
                    message: None,
                },
            );
            last_emit_at = bytes_done;
        }
    }

    file.flush().await.map_err(AppError::from)?;
    file.sync_all().await.map_err(AppError::from)?;

    emit(
        app,
        ProgressEvent {
            engine: engine_label.to_string(),
            stage: Stage::Downloading,
            bytes_done: Some(bytes_done),
            bytes_total: total.or(Some(bytes_done)),
            message: None,
        },
    );

    Ok(())
}
