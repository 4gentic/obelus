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
            description: "diff_hunks_holistic",
            sql: include_str!("../migrations/0002_diff_hunks_holistic.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "diff_hunks_reviewer_notes",
            sql: include_str!("../migrations/0003_diff_hunks_reviewer_notes.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
