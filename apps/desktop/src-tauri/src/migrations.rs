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
        Migration {
            version: 3,
            description: "hunk_apply_failure",
            sql: include_str!("../migrations/0003_hunk_apply_failure.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "paper_format",
            sql: include_str!("../migrations/0004_paper_format.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "annotation_staleness",
            sql: include_str!("../migrations/0005_annotation_staleness.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
