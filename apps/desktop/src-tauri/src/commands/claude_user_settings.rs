use serde::Serialize;
use serde_json::Value;
use tokio::fs;

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUserSettings {
    pub model: Option<String>,
    pub effort_level: Option<String>,
}

#[tauri::command]
pub async fn read_claude_user_settings() -> ClaudeUserSettings {
    let Some(home) = dirs::home_dir() else {
        return ClaudeUserSettings::default();
    };
    let path = home.join(".claude").join("settings.json");
    let Ok(bytes) = fs::read(&path).await else {
        return ClaudeUserSettings::default();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return ClaudeUserSettings::default();
    };
    let obj = match value {
        Value::Object(map) => map,
        _ => return ClaudeUserSettings::default(),
    };
    ClaudeUserSettings {
        model: obj.get("model").and_then(|v| v.as_str()).map(str::to_owned),
        effort_level: obj
            .get("effortLevel")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
    }
}
