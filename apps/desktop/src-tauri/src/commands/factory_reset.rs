// Wipes every user row in the SQLite database while preserving the schema
// and the `_sqlx_migrations` ledger. Tables are discovered dynamically from
// `sqlite_master` so new migrations are covered without touching this file.
//
// `PRAGMA defer_foreign_keys` postpones FK enforcement until COMMIT, which
// lets us DELETE in arbitrary order. The pragma is cleared automatically at
// the end of the transaction.

use sqlx::{Executor, Row};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:obelus.db";

#[tauri::command]
pub async fn factory_reset(instances: State<'_, DbInstances>) -> Result<(), String> {
    let pools = instances.0.read().await;
    let pool = pools
        .get(DB_URL)
        .ok_or_else(|| format!("unknown db: {DB_URL}"))?;
    #[allow(irrefutable_let_patterns)]
    let DbPool::Sqlite(pool) = pool
    else {
        return Err("factory_reset requires a sqlite db".into());
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    tx.execute("PRAGMA defer_foreign_keys = ON")
        .await
        .map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != '_sqlx_migrations'",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    for row in rows {
        let name: String = row.try_get(0).map_err(|e| e.to_string())?;
        let quoted = format!("\"{}\"", name.replace('"', "\"\""));
        let stmt = format!("DELETE FROM {quoted}");
        tx.execute(stmt.as_str())
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
