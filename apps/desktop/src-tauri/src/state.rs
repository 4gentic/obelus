use dashmap::DashMap;
use std::path::PathBuf;
use tokio::sync::oneshot;
use uuid::Uuid;

pub struct AppState {
    pub allowed_roots: DashMap<Uuid, PathBuf>,
    // Maps canonical path -> root id for paths that have been admitted to
    // `allowed_roots` this session. Lets the picker and rehydration flows
    // collapse repeat admits to a single id instead of leaking duplicates.
    pub vouched_paths: DashMap<PathBuf, Uuid>,
    pub claude_cancellers: DashMap<Uuid, oneshot::Sender<()>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            allowed_roots: DashMap::new(),
            vouched_paths: DashMap::new(),
            claude_cancellers: DashMap::new(),
        }
    }
}
