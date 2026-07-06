#[tauri::command]
fn workbench_entry() -> serde_json::Value {
    serde_json::json!({
        "productName": "MBSE 建模工作台",
        "course": "《基于模型的系统工程》课程大实践",
        "sampleProjectId": "tianwen-2",
        "boundary": "独立大实践工作区，不属于前 12 个小实验工作区"
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![workbench_entry])
        .run(tauri::generate_context!())
        .expect("启动 MBSE 建模工作台失败");
}
