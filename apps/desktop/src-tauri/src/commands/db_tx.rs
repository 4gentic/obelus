// Runs a list of SQL statements on a single sqlx transaction.
//
// tauri-plugin-sql exposes only `execute`/`select`, which acquire a fresh
// connection from the SQLite pool for each call. That makes explicit
// BEGIN/COMMIT unsafe: the COMMIT lands on a different connection than the
// BEGIN and SQLite reports "cannot commit - no transaction is active". This
// command reaches into the plugin's `DbPool` and runs the batch on a single
// `sqlx::Transaction`, which is both atomic and correct under a pool.
//
// Parameter binding mirrors the plugin's own `execute` implementation so
// call sites can hand over the same JSON values they already pass through
// `db.execute(...)`.

use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::Executor;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
pub struct TxStmt {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<JsonValue>,
}

#[tauri::command]
pub async fn db_tx_batch(
    db: String,
    stmts: Vec<TxStmt>,
    instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let pools = instances.0.read().await;
    let pool = pools.get(&db).ok_or_else(|| format!("unknown db: {db}"))?;
    #[allow(irrefutable_let_patterns)]
    let DbPool::Sqlite(pool) = pool
    else {
        return Err("db_tx_batch requires a sqlite db".into());
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for stmt in stmts {
        let mut q = sqlx::query(&stmt.sql);
        for value in stmt.params {
            if value.is_null() {
                q = q.bind(None::<JsonValue>);
            } else if value.is_string() {
                q = q.bind(value.as_str().unwrap().to_owned());
            } else if let Some(n) = value.as_number() {
                q = q.bind(n.as_f64().unwrap_or_default());
            } else {
                q = q.bind(value);
            }
        }
        tx.execute(q).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
