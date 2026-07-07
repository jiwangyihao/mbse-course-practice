pub mod agent_sidecar;

use agent_sidecar::{AgentSidecarRegistry, AgentSidecarStatus};
use serde_json::{json, Value};

#[tauri::command]
fn workbench_entry() -> Value {
    json!({
        "productName": "MBSE 建模工作台",
        "course": "《基于模型的系统工程》课程大实践",
        "sampleProjectId": "tianwen-2",
        "boundary": "独立大实践工作区，不属于前 12 个小实验工作区"
    })
}

#[tauri::command]
fn start_agent_sidecar(registry: tauri::State<'_, AgentSidecarRegistry>) -> Result<AgentSidecarStatus, String> {
    registry.start()
}

#[tauri::command]
fn stop_agent_sidecar(registry: tauri::State<'_, AgentSidecarRegistry>) -> Result<AgentSidecarStatus, String> {
    registry.stop()
}

#[tauri::command]
fn agent_sidecar_status(registry: tauri::State<'_, AgentSidecarRegistry>) -> Result<AgentSidecarStatus, String> {
    registry.status()
}

#[tauri::command]
fn extract_agent_candidates(
    registry: tauri::State<'_, AgentSidecarRegistry>,
    source_text: String,
) -> Result<Value, String> {
    registry.extract_candidates(&source_text)
}

#[tauri::command]
fn generate_agent_model_draft(
    registry: tauri::State<'_, AgentSidecarRegistry>,
    source_text: String,
    confirmed_data: Option<Value>,
) -> Result<Value, String> {
    registry.generate_model_draft(&source_text, confirmed_data)
}

pub fn run() {
    tauri::Builder::default()
        .manage(AgentSidecarRegistry::default())
        .invoke_handler(tauri::generate_handler![
            workbench_entry,
            start_agent_sidecar,
            stop_agent_sidecar,
            agent_sidecar_status,
            extract_agent_candidates,
            generate_agent_model_draft
        ])
        .run(tauri::generate_context!())
        .expect("启动 MBSE 建模工作台失败");
}
