use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

pub struct AppState {
    pub allowed_roots: DashMap<Uuid, PathBuf>,
    // Maps canonical path -> root id for paths that have been admitted to
    // `allowed_roots` this session. Lets the picker and rehydration flows
    // collapse repeat admits to a single id instead of leaking duplicates.
    pub vouched_paths: DashMap<PathBuf, Uuid>,
    pub claude_cancellers: DashMap<Uuid, oneshot::Sender<()>>,
    // Per-root serialization for snapshot/apply. A double-clicked Apply or a
    // snapshot-during-apply would otherwise race on the blob store, the backup
    // dir, and the paper_edits unique-ordinal index.
    pub root_locks: DashMap<String, Arc<Mutex<()>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            allowed_roots: DashMap::new(),
            vouched_paths: DashMap::new(),
            claude_cancellers: DashMap::new(),
            root_locks: DashMap::new(),
        }
    }

    pub fn root_lock(&self, root_id: &str) -> Arc<Mutex<()>> {
        self.root_locks
            .entry(root_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
