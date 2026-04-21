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
            description: "claude_model_effort",
            sql: include_str!("../migrations/0002_claude_model_effort.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "file_pins",
            sql: include_str!("../migrations/0003_file_pins.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
