pub mod agent_sidecar;
pub mod workbench_project;

use agent_sidecar::{AgentSidecarRegistry, AgentSidecarStatus};
use serde_json::{json, Value};
use tauri::Emitter;
use workbench_project::{
    export_workbench_project as export_saved_workbench_project,
    load_workbench_project as load_saved_workbench_project,
    save_workbench_project as save_saved_workbench_project,
    ProjectExportBundle,
    SavedWorkbenchProjectState,
};

#[tauri::command]
fn workbench_entry() -> Value {
    json!({
        "productName": "MBSE 建模工作台",
        "sampleProjectId": "tianwen-2",
        "boundary": "独立工作区"
    })
}

#[tauri::command]
fn start_agent_sidecar(
    registry: tauri::State<'_, AgentSidecarRegistry>,
) -> Result<AgentSidecarStatus, String> {
    registry.start()
}

#[tauri::command]
fn stop_agent_sidecar(
    registry: tauri::State<'_, AgentSidecarRegistry>,
) -> Result<AgentSidecarStatus, String> {
    registry.stop()
}

#[tauri::command]
fn agent_sidecar_status(
    registry: tauri::State<'_, AgentSidecarRegistry>,
) -> Result<AgentSidecarStatus, String> {
    registry.status()
}

#[tauri::command]
fn preflight_agent_sidecar(
    registry: tauri::State<'_, AgentSidecarRegistry>,
) -> Result<AgentSidecarStatus, String> {
    registry.preflight()
}

#[tauri::command]
fn extract_agent_candidates(
    app: tauri::AppHandle,
    registry: tauri::State<'_, AgentSidecarRegistry>,
    source_text: String,
) -> Result<Value, String> {
    let progress_app = app.clone();
    registry.extract_candidates_with_progress(&source_text, move |event| {
        let _ = progress_app.emit("agent-sidecar-event", event.clone());
    })
}

#[tauri::command]
fn generate_agent_model_draft(
    app: tauri::AppHandle,
    registry: tauri::State<'_, AgentSidecarRegistry>,
    source_text: String,
    confirmed_data: Option<Value>,
) -> Result<Value, String> {
    let progress_app = app.clone();
    registry.generate_model_draft_with_progress(&source_text, confirmed_data, move |event| {
        let _ = progress_app.emit("agent-sidecar-event", event.clone());
    })
}

#[tauri::command]
fn save_workbench_project(
    app: tauri::AppHandle,
    project: SavedWorkbenchProjectState,
) -> Result<SavedWorkbenchProjectState, String> {
    save_saved_workbench_project(&app, project)
}

#[tauri::command]
fn load_workbench_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<SavedWorkbenchProjectState, String> {
    load_saved_workbench_project(&app, &project_id)
}

#[tauri::command]
fn export_workbench_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectExportBundle, String> {
    export_saved_workbench_project(&app, &project_id)
}

pub fn run() {
    tauri::Builder::default()
        .manage(AgentSidecarRegistry::default())
        .invoke_handler(tauri::generate_handler![
            workbench_entry,
            start_agent_sidecar,
            stop_agent_sidecar,
            agent_sidecar_status,
            preflight_agent_sidecar,
            extract_agent_candidates,
            generate_agent_model_draft,
            save_workbench_project,
            load_workbench_project,
            export_workbench_project
        ])
        .run(tauri::generate_context!())
        .expect("启动 MBSE 建模工作台失败");
}
