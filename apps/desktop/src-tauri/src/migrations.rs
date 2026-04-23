use tauri_plugin_sql::{Migration, MigrationKind};

pub fn all() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "review_session_status",
            sql: include_str!("../migrations/0002_review_session_status.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
