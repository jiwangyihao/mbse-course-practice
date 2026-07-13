use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const WORKBENCH_STATE_FILE: &str = "workbench-state.json";
const APP_EXPORT_ROOT: &str = "mbse-workbench-projects";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedProjectFile {
    pub path: String,
    pub content: String,
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWorkbenchProjectState {
    pub project_root: Option<String>,
    pub saved_at: Option<String>,
    pub manifest_path: String,
    pub manifest: Value,
    pub source_materials: Vec<Value>,
    pub model_artifacts: Vec<Value>,
    pub confirmed_data: Option<Value>,
    pub generated_artifacts: Option<Value>,
    pub sidecar_draft: Option<Value>,
    pub agent_trace_sessions: Option<Value>,
    #[serde(alias = "lastExportedPackage")]
    pub last_exported_bundle: Option<ProjectExportBundle>,
    pub files: Vec<PersistedProjectFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExportArtifact {
    pub id: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub title: String,
    pub path: String,
    pub source: String,
    pub required: bool,
    pub status: String,
    pub media_type: String,
    pub content: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExportChecklistItem {
    pub id: String,
    pub title: String,
    pub status: String,
    pub artifact_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExportBundle {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub source: String,
    pub mode: String,
    pub manifest_path: String,
    pub output_root: Option<String>,
    pub exported_at: Option<String>,
    pub artifacts: Vec<ProjectExportArtifact>,
    pub checklist: Vec<ProjectExportChecklistItem>,
}

pub fn save_workbench_project(
    app: &AppHandle,
    mut project: SavedWorkbenchProjectState,
) -> Result<SavedWorkbenchProjectState, String> {
    let project_id = read_project_id(&project.manifest)?;
    let projects_root = saved_projects_root(app)?;
    let project_root = projects_root.join(&project_id);
    reject_symlink(&projects_root)?;
    if project_root.exists() {
        reject_symlink(&project_root)?;
    }

    project.last_exported_bundle = None;
    let normalized_manifest_path = sanitize_relative_path(&project.manifest_path)?;
    let staging_root = projects_root.join(format!("{project_id}.staging-{}", now_millis_string()));
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root)
            .map_err(|error| format!("清理旧暂存目录失败：{error}"))?;
    }
    fs::create_dir_all(&staging_root)
        .map_err(|error| format!("创建工作台项目暂存目录失败：{error}"))?;

    validate_agent_trace_sessions(project.agent_trace_sessions.as_ref())?;
    let normalized_files = project
        .files
        .iter()
        .map(|file| sanitize_persisted_file(file, &staging_root))
        .collect::<Result<Vec<_>, _>>()?;

    let manifest_present = normalized_files.iter().any(|(_, file)| {
        sanitize_relative_path(&file.path).ok() == Some(normalized_manifest_path.clone())
    });
    if !manifest_present {
        return Err(format!(
            "已保存项目缺少 manifestPath 对应文件：{}",
            project.manifest_path
        ));
    }

    for (path, file) in &normalized_files {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建项目文件目录失败：{error}"))?;
        }
        fs::write(path, file.content.as_bytes())
            .map_err(|error| format!("写入项目文件 {} 失败：{error}", file.path))?;
    }

    project.project_root = Some(path_string(&project_root));
    project.saved_at = Some(now_millis_string());
    project.manifest_path = path_string(&normalized_manifest_path);
    project.files = normalized_files.into_iter().map(|(_, file)| file).collect();

    let state_path = staging_root.join(WORKBENCH_STATE_FILE);
    let state_bytes = serde_json::to_vec_pretty(&project)
        .map_err(|error| format!("序列化工作台项目状态失败：{error}"))?;
    fs::write(&state_path, state_bytes)
        .map_err(|error| format!("写入工作台项目状态失败：{error}"))?;

    let backup_root = projects_root.join(format!("{project_id}.backup"));
    if backup_root.exists() {
        fs::remove_dir_all(&backup_root)
            .map_err(|error| format!("清理旧工作台项目备份失败：{error}"))?;
    }

    if project_root.exists() {
        fs::rename(&project_root, &backup_root)
            .map_err(|error| format!("备份现有工作台项目失败：{error}"))?;
        fs::rename(&staging_root, &project_root).map_err(|error| {
            let _ = fs::rename(&backup_root, &project_root);
            format!("用新修订替换工作台项目失败：{error}")
        })?;
    } else {
        fs::rename(&staging_root, &project_root)
            .map_err(|error| format!("提交工作台项目暂存目录失败：{error}"))?;
    }

    Ok(project)
}

pub fn load_workbench_project(
    app: &AppHandle,
    project_id: &str,
) -> Result<SavedWorkbenchProjectState, String> {
    let projects_root = saved_projects_root(app)?;
    let project_root = projects_root.join(project_id);
    let backup_root = projects_root.join(format!("{project_id}.backup"));
    if !project_root.exists() && backup_root.exists() {
        reject_symlink(&backup_root)?;
        fs::rename(&backup_root, &project_root)
            .map_err(|error| format!("恢复工作台项目备份失败：{error}"))?;
    }
    let state_path = project_root.join(WORKBENCH_STATE_FILE);
    let state_content = fs::read_to_string(&state_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("工作台项目状态文件不存在：{}", state_path.display())
        } else {
            format!("读取工作台项目状态失败：{error}")
        }
    })?;
    let mut project: SavedWorkbenchProjectState = serde_json::from_str(&state_content)
        .map_err(|error| format!("解析工作台项目状态失败：{error}"))?;

    validate_agent_trace_sessions(project.agent_trace_sessions.as_ref())?;
    let normalized_manifest_path = sanitize_relative_path(&project.manifest_path)?;
    let normalized_files = project
        .files
        .iter()
        .map(|file| sanitize_persisted_file(file, &project_root))
        .collect::<Result<Vec<_>, _>>()?;

    let manifest_present = normalized_files.iter().any(|(_, file)| {
        sanitize_relative_path(&file.path).ok() == Some(normalized_manifest_path.clone())
    });
    if !manifest_present {
        return Err(format!(
            "已保存项目缺少 manifestPath 对应文件：{}",
            project.manifest_path
        ));
    }

    project.project_root = Some(path_string(&project_root));
    project.manifest_path = path_string(&normalized_manifest_path);
    project.files = normalized_files
        .into_iter()
        .map(|(path, mut file)| {
            file.content = fs::read_to_string(&path)
                .map_err(|error| format!("读取项目文件 {} 失败：{error}", file.path))?;
            Ok(file)
        })
        .collect::<Result<Vec<_>, String>>()?;
    project.last_exported_bundle =
        normalize_project_export_bundle(project.last_exported_bundle.take(), &project)?;

    Ok(project)
}

pub fn export_workbench_project(
    app: &AppHandle,
    project_id: &str,
) -> Result<ProjectExportBundle, String> {
    let saved_project = load_workbench_project(app, project_id)?;
    let mut exported_bundle = build_project_export_bundle(&saved_project)?;
    let exports_root = saved_projects_root(app)?.join("exports");
    fs::create_dir_all(&exports_root).map_err(|error| format!("创建项目包根目录失败：{error}"))?;
    let export_root = exports_root.join(project_id);
    let project_root = saved_project_root(app, project_id)?;

    if export_root.exists() {
        fs::remove_dir_all(&export_root)
            .map_err(|error| format!("清理旧项目包目录失败：{error}"))?;
    }
    fs::create_dir_all(&export_root).map_err(|error| format!("创建项目包目录失败：{error}"))?;

    exported_bundle.mode = "exported".to_string();
    exported_bundle.output_root = Some(path_string(&export_root));
    exported_bundle.exported_at = Some(now_millis_string());

    for artifact in &mut exported_bundle.artifacts {
        let write_result = materialize_export_artifact(&saved_project, &export_root, artifact);

        match write_result {
            Ok(true) => {
                artifact.status = "included".to_string();
                artifact.detail = None;
            }
            Ok(false) => {}
            Err(error) => {
                artifact.status = "missing".to_string();
                artifact.detail = Some(error);
            }
        }
    }

    exported_bundle.checklist =
        rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);

    let manifest_artifact_index = exported_bundle
        .artifacts
        .iter()
        .position(|artifact| artifact.artifact_type == "export-manifest");
    if let Some(index) = manifest_artifact_index {
        exported_bundle.artifacts[index].status = "included".to_string();
        exported_bundle.artifacts[index].detail = None;
        exported_bundle.checklist =
            rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);
        let manifest_content = build_export_manifest(&exported_bundle)?;
        exported_bundle.artifacts[index].content = manifest_content;

        let write_result = {
            let manifest_artifact = &exported_bundle.artifacts[index];
            write_text_artifact(&export_root, manifest_artifact)
        };

        if let Err(error) = write_result {
            exported_bundle.artifacts[index].status = "missing".to_string();
            exported_bundle.artifacts[index].detail = Some(error);
            exported_bundle.checklist =
                rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);
            exported_bundle.artifacts[index].content = build_export_manifest(&exported_bundle)?;
        }
    }
    let mut persisted_project = saved_project.clone();
    persisted_project.last_exported_bundle = Some(exported_bundle.clone());
    persisted_project.saved_at = Some(now_millis_string());
    persisted_project.project_root = Some(path_string(&project_root));
    let state_bytes = serde_json::to_vec_pretty(&persisted_project)
        .map_err(|error| format!("序列化导出后的工作台项目状态失败：{error}"))?;
    fs::write(project_root.join(WORKBENCH_STATE_FILE), state_bytes)
        .map_err(|error| format!("写入导出后的工作台项目状态失败：{error}"))?;

    exported_bundle.checklist =
        rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);
    Ok(exported_bundle)
}

fn build_project_export_bundle(
    saved_project: &SavedWorkbenchProjectState,
) -> Result<ProjectExportBundle, String> {
    let project_id = read_project_id(&saved_project.manifest)?;
    let project_name = read_string(saved_project.manifest.get("name"), &project_id);
    let persisted_project_root = format!("sample-projects/{project_id}/");
    let sysml_root = format!("{persisted_project_root}model/");
    let project_export_root = format!("project/{project_id}");
    let project_content_root = format!("{project_export_root}/sample-projects/{project_id}");

    let sysml_artifacts = saved_project
        .model_artifacts
        .iter()
        .filter(|artifact| artifact.get("kind").and_then(Value::as_str) == Some("sysml-v2"))
        .collect::<Vec<_>>();
    let sysml_export_artifacts = sysml_artifacts
        .iter()
        .enumerate()
        .map(|(index, artifact)| {
            let sysml_path = artifact
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "已保存项目缺少 SysML v2 工件路径。".to_string())?;
            let relative_model_path =
                sysml_path
                    .strip_prefix(sysml_root.as_str())
                    .ok_or_else(|| {
                        format!(
                            "SysML v2 工件路径必须位于 {} 下：{}",
                            sysml_root, sysml_path
                        )
                    })?;
            let (status, content, detail) = match find_saved_file(saved_project, sysml_path) {
                Some(sysml_file) => ("ready".to_string(), sysml_file.content.clone(), None),
                None => (
                    "missing".to_string(),
                    String::new(),
                    Some(format!(
                        "已保存项目中缺少 SysML v2 源文件：{}。",
                        relative_model_path
                    )),
                ),
            };

            Ok(ProjectExportArtifact {
                id: read_string(
                    artifact.get("id"),
                    &format!("{project_id}-sysml-{}", index + 1),
                ),
                artifact_type: "sysml-v2".to_string(),
                title: read_string(
                    artifact.get("title"),
                    &format!("SysML v2 源文件 {}", relative_model_path),
                ),
                path: format!("{project_content_root}/model/{relative_model_path}"),
                source: sysml_path.to_string(),
                required: true,
                status,
                media_type: "text/x-sysml".to_string(),
                content,
                detail,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let view_model_artifact = saved_project
        .model_artifacts
        .iter()
        .find(|artifact| artifact.get("kind").and_then(Value::as_str) == Some("json-view-model"));
    let view_model_path = view_model_artifact
        .and_then(|artifact| artifact.get("path").and_then(Value::as_str))
        .ok_or_else(|| "已保存项目缺少 JSON 视图模型工件路径。".to_string())?;
    let view_model_file = find_saved_file(saved_project, view_model_path)
        .ok_or_else(|| "已保存项目缺少 JSON 视图模型工件内容。".to_string())?;

    let validation_path = format!("sample-projects/{project_id}/model/validation-result.json");
    let validation_file = find_saved_file(saved_project, &validation_path);
    let validation_value = if let Some(file) = validation_file {
        serde_json::from_str::<Value>(&file.content)
            .map_err(|error| format!("解析已保存 validation 结果失败：{error}"))?
    } else if let Some(validation) = saved_project
        .generated_artifacts
        .as_ref()
        .and_then(|generated| generated.get("validation"))
    {
        validation.clone()
    } else {
        json!({
            "valid": false,
            "errors": [{ "code": "schema", "message": "缺少 validation 结果。", "path": "$.validation" }],
            "findings": []
        })
    };

    let mut artifacts = vec![ProjectExportArtifact {
        id: project_id.replace("tianwen-2", "tw2") + "-saved-project",
        artifact_type: "saved-project".to_string(),
        title: "项目内容".to_string(),
        path: project_export_root.clone(),
        source: saved_project.manifest_path.clone(),
        required: true,
        status: "ready".to_string(),
        media_type: "application/json".to_string(),
        content: serde_json::to_string_pretty(&json!({
            "statePath": format!("{project_export_root}/{WORKBENCH_STATE_FILE}"),
            "manifestPath": saved_project.manifest_path,
            "files": saved_project.files.iter().map(|file| json!({
                "path": format!("{project_export_root}/{}", file.path),
                "mediaType": file.media_type,
            })).collect::<Vec<_>>(),
        }))
        .map_err(|error| format!("序列化项目快照摘要失败：{error}"))?,
        detail: None,
    }];
    artifacts.extend(sysml_export_artifacts);
    artifacts.extend([
        ProjectExportArtifact {
            id: read_string(
                view_model_artifact.and_then(|artifact| artifact.get("id")),
                &format!("{project_id}-view-model"),
            ),
            artifact_type: "json-view-model".to_string(),
            title: read_string(
                view_model_artifact.and_then(|artifact| artifact.get("title")),
                "JSON 视图模型",
            ),
            path: format!("{project_content_root}/model/view-model.json"),
            source: view_model_path.to_string(),
            required: true,
            status: "ready".to_string(),
            media_type: "application/json".to_string(),
            content: view_model_file.content.clone(),
            detail: None,
        },
        ProjectExportArtifact {
            id: project_id.replace("tianwen-2", "tw2") + "-validation-result",
            artifact_type: "validation-result".to_string(),
            title: "validation 结果".to_string(),
            path: format!("{project_content_root}/model/validation-result.json"),
            source: validation_file
                .map(|file| file.path.clone())
                .unwrap_or_else(|| validation_path.clone()),
            required: true,
            status: "ready".to_string(),
            media_type: "application/json".to_string(),
            content: serde_json::to_string_pretty(&validation_value)
                .map_err(|error| format!("序列化 validation 结果失败：{error}"))?,
            detail: None,
        },
        ProjectExportArtifact {
            id: project_id.replace("tianwen-2", "tw2") + "-export-manifest",
            artifact_type: "export-manifest".to_string(),
            title: "导出清单".to_string(),
            path: "export/manifest.json".to_string(),
            source: saved_project.manifest_path.clone(),
            required: true,
            status: "ready".to_string(),
            media_type: "application/json".to_string(),
            content: String::new(),
            detail: None,
        },
    ]);

    let checklist = vec![
        build_checklist_item("saved-project", "项目内容", &artifacts, &["saved-project"]),
        build_checklist_item("model-source", "SysML v2 文本", &artifacts, &["sysml-v2"]),
        build_checklist_item(
            "view-model",
            "JSON 视图模型",
            &artifacts,
            &["json-view-model"],
        ),
        build_checklist_item(
            "validation",
            "validation 结果",
            &artifacts,
            &["validation-result"],
        ),
        build_checklist_item(
            "export-manifest",
            "导出清单",
            &artifacts,
            &["export-manifest"],
        ),
    ];

    let mut bundle = ProjectExportBundle {
        id: format!("{project_id}-project-export"),
        project_id,
        project_name,
        source: "persisted-project-state".to_string(),
        mode: "planned".to_string(),
        manifest_path: saved_project.manifest_path.clone(),
        output_root: None,
        exported_at: None,
        artifacts,
        checklist,
    };
    if let Some(index) = bundle
        .artifacts
        .iter()
        .position(|artifact| artifact.artifact_type == "export-manifest")
    {
        bundle.artifacts[index].content = build_export_manifest(&bundle)?;
    }
    Ok(bundle)
}

fn build_checklist_item(
    id: &str,
    title: &str,
    artifacts: &[ProjectExportArtifact],
    types: &[&str],
) -> ProjectExportChecklistItem {
    let matched_artifacts = artifacts
        .iter()
        .filter(|artifact| types.contains(&artifact.artifact_type.as_str()))
        .collect::<Vec<_>>();
    let artifact_ids = matched_artifacts
        .iter()
        .map(|artifact| artifact.id.clone())
        .collect::<Vec<_>>();
    let status = if matched_artifacts.is_empty() {
        "missing"
    } else if matched_artifacts
        .iter()
        .all(|artifact| artifact.status == "included")
    {
        "included"
    } else if matched_artifacts
        .iter()
        .any(|artifact| artifact.status == "missing")
    {
        "missing"
    } else {
        "ready"
    };

    ProjectExportChecklistItem {
        id: id.to_string(),
        title: title.to_string(),
        status: status.to_string(),
        artifact_ids,
    }
}

fn materialize_saved_project(
    saved_project: &SavedWorkbenchProjectState,
    export_root: &Path,
    artifact: &ProjectExportArtifact,
) -> Result<(), String> {
    let target_root = export_root.join(sanitize_relative_path(&artifact.path)?);
    let manifest_path = sanitize_relative_path(&saved_project.manifest_path)?;
    let persisted_root = manifest_path.parent().ok_or_else(|| {
        format!(
            "项目清单路径缺少项目根目录：{}",
            saved_project.manifest_path
        )
    })?;

    fs::create_dir_all(&target_root).map_err(|error| format!("创建项目包内容目录失败：{error}"))?;
    for file in &saved_project.files {
        let file_path = sanitize_relative_path(&file.path)?;
        if !file_path.starts_with(persisted_root) {
            return Err(format!(
                "已保存项目文件 {} 不在项目根目录 {} 下。",
                file.path,
                persisted_root.display()
            ));
        }
        let target_path = target_root.join(&file_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建项目包文件目录失败：{error}"))?;
        }
        fs::write(&target_path, file.content.as_bytes())
            .map_err(|error| format!("写入项目包文件 {} 失败：{error}", file.path))?;
    }

    let mut portable_state = saved_project.clone();
    portable_state.project_root = None;
    portable_state.last_exported_bundle = None;
    let state_bytes = serde_json::to_vec_pretty(&portable_state)
        .map_err(|error| format!("序列化项目包状态失败：{error}"))?;
    fs::write(target_root.join(WORKBENCH_STATE_FILE), state_bytes)
        .map_err(|error| format!("写入项目包状态失败：{error}"))?;
    Ok(())
}

fn materialize_export_artifact(
    saved_project: &SavedWorkbenchProjectState,
    export_root: &Path,
    artifact: &ProjectExportArtifact,
) -> Result<bool, String> {
    match artifact.artifact_type.as_str() {
        "saved-project" => {
            materialize_saved_project(saved_project, export_root, artifact).map(|()| true)
        }
        "export-manifest" => Ok(true),
        "sysml-v2" if artifact.status == "missing" => Ok(false),
        _ => write_text_artifact(export_root, artifact).map(|()| true),
    }
}

fn write_text_artifact(export_root: &Path, artifact: &ProjectExportArtifact) -> Result<(), String> {
    let target_path = export_root.join(sanitize_relative_path(&artifact.path)?);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建项目包文件目录失败：{error}"))?;
    }
    fs::write(&target_path, artifact.content.as_bytes())
        .map_err(|error| format!("写入项目包工件 {} 失败：{error}", artifact.title))?;
    Ok(())
}

fn rebuild_checklist(
    artifacts: &[ProjectExportArtifact],
    current_checklist: &[ProjectExportChecklistItem],
) -> Vec<ProjectExportChecklistItem> {
    let status_by_id = artifacts
        .iter()
        .map(|artifact| (artifact.id.as_str(), artifact.status.as_str()))
        .collect::<HashMap<_, _>>();

    current_checklist
        .iter()
        .map(|item| {
            let mut status = "included";
            for artifact_id in &item.artifact_ids {
                match status_by_id.get(artifact_id.as_str()).copied() {
                    Some("missing") => {
                        status = "missing";
                        break;
                    }
                    Some("ready") if status != "missing" => {
                        status = "ready";
                    }
                    Some("included") => {}
                    _ => {
                        status = "missing";
                        break;
                    }
                }
            }
            ProjectExportChecklistItem {
                id: item.id.clone(),
                title: item.title.clone(),
                status: status.to_string(),
                artifact_ids: item.artifact_ids.clone(),
            }
        })
        .collect()
}

fn build_export_manifest(bundle: &ProjectExportBundle) -> Result<String, String> {
    serde_json::to_string_pretty(&json!({
        "projectId": bundle.project_id,
        "projectName": bundle.project_name,
        "source": bundle.source,
        "mode": bundle.mode,
        "manifestPath": bundle.manifest_path,
        "outputRoot": bundle.output_root,
        "exportedAt": bundle.exported_at,
        "artifacts": bundle.artifacts.iter().map(|artifact| json!({
            "id": artifact.id,
            "type": artifact.artifact_type,
            "title": artifact.title,
            "path": artifact.path,
            "source": artifact.source,
            "required": artifact.required,
            "status": artifact.status,
            "mediaType": artifact.media_type,
            "detail": artifact.detail,
        })).collect::<Vec<_>>(),
        "checklist": bundle.checklist.iter().map(|item| json!({
            "id": item.id,
            "title": item.title,
            "status": item.status,
            "artifactIds": item.artifact_ids,
        })).collect::<Vec<_>>(),
    }))
    .map_err(|error| format!("生成导出清单失败：{error}"))
}

fn find_saved_file<'a>(
    saved_project: &'a SavedWorkbenchProjectState,
    expected_path: &str,
) -> Option<&'a PersistedProjectFile> {
    let normalized_expected = expected_path.replace('\\', "/");
    saved_project
        .files
        .iter()
        .find(|file| file.path.replace('\\', "/") == normalized_expected)
}

fn normalize_project_export_bundle(
    bundle: Option<ProjectExportBundle>,
    saved_project: &SavedWorkbenchProjectState,
) -> Result<Option<ProjectExportBundle>, String> {
    let Some(bundle) = bundle else {
        return Ok(None);
    };

    let requires_migration = bundle
        .artifacts
        .iter()
        .any(|artifact| !is_supported_project_export_artifact_type(&artifact.artifact_type));
    if !requires_migration {
        return Ok(Some(bundle));
    }

    let planned_bundle = build_project_export_bundle(saved_project)?;
    let mut previous_by_type = HashMap::new();
    for artifact in &bundle.artifacts {
        if is_supported_project_export_artifact_type(&artifact.artifact_type) {
            previous_by_type
                .entry(artifact.artifact_type.clone())
                .or_insert_with(|| artifact.clone());
        }
    }

    let mut migrated_bundle = planned_bundle.clone();
    migrated_bundle.mode = if bundle.mode == "exported" {
        "exported".to_string()
    } else {
        "planned".to_string()
    };
    migrated_bundle.output_root = bundle.output_root.filter(|value| !value.trim().is_empty());
    migrated_bundle.exported_at = bundle.exported_at.filter(|value| !value.trim().is_empty());
    migrated_bundle.artifacts = planned_bundle
        .artifacts
        .iter()
        .map(|artifact| {
            if let Some(previous_artifact) = previous_by_type.get(&artifact.artifact_type) {
                let mut next_artifact = artifact.clone();
                next_artifact.status =
                    normalize_export_artifact_status(&previous_artifact.status).to_string();
                next_artifact.detail = previous_artifact.detail.clone();
                next_artifact
            } else {
                artifact.clone()
            }
        })
        .collect();
    migrated_bundle.checklist =
        rebuild_checklist(&migrated_bundle.artifacts, &planned_bundle.checklist);
    if let Some(index) = migrated_bundle
        .artifacts
        .iter()
        .position(|artifact| artifact.artifact_type == "export-manifest")
    {
        migrated_bundle.artifacts[index].content = build_export_manifest(&migrated_bundle)?;
    }
    Ok(Some(migrated_bundle))
}

fn is_supported_project_export_artifact_type(artifact_type: &str) -> bool {
    matches!(
        artifact_type,
        "saved-project" | "sysml-v2" | "json-view-model" | "validation-result" | "export-manifest"
    )
}

fn normalize_export_artifact_status(status: &str) -> &str {
    match status {
        "included" => "included",
        "missing" => "missing",
        _ => "ready",
    }
}

fn read_project_id(manifest: &Value) -> Result<String, String> {
    let project_id = manifest
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "工作台项目缺少 manifest.id。".to_string())?;

    if !project_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!("非法 projectId：{project_id}"));
    }

    Ok(project_id.to_string())
}

fn saved_projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .local_data_dir()
        .map_err(|error| format!("解析本地工作台数据目录失败：{error}"))?
        .join(APP_EXPORT_ROOT);
    if root.exists() {
        reject_symlink(&root)?;
    }
    fs::create_dir_all(&root).map_err(|error| format!("创建工作台数据根目录失败：{error}"))?;
    Ok(root)
}

fn saved_project_root(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let sanitized_project_id = read_project_id(&json!({ "id": project_id }))?;
    Ok(saved_projects_root(app)?.join(sanitized_project_id))
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("读取路径元数据失败 {}：{error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("不允许使用符号链接路径：{}", path.display()));
    }
    Ok(())
}

fn sanitize_relative_path(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空。".to_string());
    }

    let normalized = trimmed.replace('\\', "/");
    let candidate = Path::new(&normalized);
    let bytes = normalized.as_bytes();
    let looks_like_windows_absolute = bytes.len() >= 3 && bytes[1] == b':' && bytes[2] == b'/';
    if candidate.is_absolute() || looks_like_windows_absolute {
        return Err(format!("不允许绝对路径：{raw_path}"));
    }

    let mut relative_path = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(segment) => relative_path.push(segment),
            Component::CurDir => {}
            Component::ParentDir => return Err(format!("不允许包含 .. 的路径：{raw_path}")),
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("不允许绝对路径：{raw_path}"))
            }
        }
    }

    if relative_path.as_os_str().is_empty() {
        return Err(format!("非法相对路径：{raw_path}"));
    }

    Ok(relative_path)
}

fn sanitize_persisted_file(
    file: &PersistedProjectFile,
    project_root: &Path,
) -> Result<(PathBuf, PersistedProjectFile), String> {
    let relative_path = sanitize_relative_path(&file.path)?;
    let mut current = project_root.to_path_buf();
    if current.exists() {
        reject_symlink(&current)?;
    }
    for component in relative_path.components() {
        current.push(component.as_os_str());
        if current.exists() {
            reject_symlink(&current)?;
        }
    }

    Ok((
        current,
        PersistedProjectFile {
            path: path_string(&relative_path),
            content: file.content.clone(),
            media_type: file.media_type.clone(),
        },
    ))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn now_millis_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn read_string(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or(fallback)
        .to_string()
}
fn validate_agent_trace_sessions(sessions: Option<&Value>) -> Result<(), String> {
    let Some(sessions) = sessions else {
        return Ok(());
    };
    let Value::Array(entries) = sessions else {
        return Err("agentTraceSessions 必须是会话数组。".to_string());
    };
    for (index, session) in entries.iter().enumerate() {
        let session_id = session
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or("");
        if session_id.trim().is_empty() {
            return Err(format!("agentTraceSessions[{index}] 缺少非空 sessionId。"));
        }
        match session.get("events") {
            Some(Value::Array(_)) => {}
            _ => return Err(format!("agentTraceSessions[{index}] 缺少 events 数组。")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_project_export_bundle, materialize_export_artifact, rebuild_checklist,
        sanitize_relative_path, write_text_artifact, PersistedProjectFile,
        SavedWorkbenchProjectState, WORKBENCH_STATE_FILE,
    };
    use serde_json::{json, Value};
    use std::{
        env, fs,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    #[test]
    fn rejects_absolute_paths() {
        assert!(sanitize_relative_path("C:/tmp/outside.txt").is_err());
        assert!(sanitize_relative_path("C:\\tmp\\outside.txt").is_err());
        assert!(sanitize_relative_path("/tmp/outside.txt").is_err());
    }

    #[test]
    fn rejects_parent_segments() {
        assert!(sanitize_relative_path("../outside.txt").is_err());
        assert!(sanitize_relative_path("sample-projects/../../outside.txt").is_err());
    }

    #[test]
    fn accepts_clean_relative_paths() {
        let path = sanitize_relative_path("sample-projects/tianwen-2/model/view-model.json")
            .expect("valid path");
        assert_eq!(
            path.to_string_lossy().replace('\\', "/"),
            "sample-projects/tianwen-2/model/view-model.json"
        );
    }

    #[test]
    fn state_file_roundtrip_preserves_sidecar_draft() {
        let state = SavedWorkbenchProjectState {
            project_root: Some("local/project-root".to_string()),
            saved_at: Some("1234567890".to_string()),
            manifest_path: "sample-projects/tianwen-2/project.json".to_string(),
            manifest: json!({ "id": "tianwen-2", "name": "天问二号探测器样例项目" }),
            source_materials: vec![
                json!({ "id": "tw2-source", "title": "材料", "path": "sample-projects/tianwen-2/materials/source-material.md" }),
            ],
            model_artifacts: sample_model_artifacts(),
            confirmed_data: Some(json!({ "projectId": "tianwen-2" })),
            generated_artifacts: Some(json!({ "sourceSet": { "files": [] } })),
            sidecar_draft: Some(
                json!({ "sourceSet": { "files": [] }, "viewModel": { "views": [] } }),
            ),
            agent_trace_sessions: Some(json!([{ "sessionId": "trace-session", "events": [] }])),
            last_exported_bundle: None,
            files: vec![PersistedProjectFile {
                path: "sample-projects/tianwen-2/project.json".to_string(),
                content: "{}".to_string(),
                media_type: "application/json".to_string(),
            }],
        };

        let serialized = serde_json::to_string(&state).expect("state should serialize");
        let restored: SavedWorkbenchProjectState =
            serde_json::from_str(&serialized).expect("state should deserialize");

        assert!(restored.sidecar_draft.is_some());
        assert!(restored.agent_trace_sessions.is_some());
        assert_eq!(
            restored
                .model_artifacts
                .iter()
                .filter(|artifact| artifact.get("kind").and_then(Value::as_str) == Some("sysml-v2"))
                .count(),
            5
        );
    }
    #[test]
    fn deserializes_legacy_last_exported_package_alias() {
        let legacy_state = json!({
            "projectRoot": null,
            "savedAt": null,
            "manifestPath": "sample-projects/tianwen-2/project.json",
            "manifest": { "id": "tianwen-2", "name": "天问二号探测器样例项目" },
            "sourceMaterials": [],
            "modelArtifacts": [],
            "confirmedData": null,
            "generatedArtifacts": null,
            "sidecarDraft": null,
            "lastExportedPackage": {
                "id": "legacy-export",
                "projectId": "tianwen-2",
                "projectName": "天问二号探测器样例项目",
                "source": "workbench",
                "mode": "directory",
                "manifestPath": "sample-projects/tianwen-2/project.json",
                "outputRoot": null,
                "exportedAt": "2026-07-01T00:00:00.000Z",
                "artifacts": [],
                "checklist": []
            },
            "files": []
        });

        let restored: SavedWorkbenchProjectState =
            serde_json::from_value(legacy_state).expect("legacy state should deserialize");

        assert_eq!(
            restored
                .last_exported_bundle
                .as_ref()
                .map(|bundle| bundle.id.as_str()),
            Some("legacy-export")
        );
    }

    #[test]
    fn rejects_non_array_agent_trace_sessions_shape() {
        let invalid = json!({ "length": 1 });
        assert!(super::validate_agent_trace_sessions(Some(&invalid)).is_err());
    }

    #[test]
    fn rejects_agent_trace_session_without_events_array() {
        let invalid = json!([{ "sessionId": "trace-session", "events": {} }]);
        assert!(super::validate_agent_trace_sessions(Some(&invalid)).is_err());
    }

    #[test]
    fn rejects_null_agent_trace_sessions_shape() {
        assert!(super::validate_agent_trace_sessions(None).is_ok());
        let null_value = Value::Null;
        assert!(super::validate_agent_trace_sessions(Some(&null_value)).is_err());
    }

    #[test]
    fn accepts_empty_agent_trace_sessions_array() {
        let empty = json!([]);
        assert!(super::validate_agent_trace_sessions(Some(&empty)).is_ok());
    }

    #[test]
    fn rejects_blank_agent_trace_session_id() {
        let invalid = json!([{ "sessionId": "   ", "events": [] }]);
        assert!(super::validate_agent_trace_sessions(Some(&invalid)).is_err());
    }

    #[test]
    fn planned_export_paths_match_written_artifact_locations() {
        let saved_project = SavedWorkbenchProjectState {
            project_root: Some("local/project-root".to_string()),
            saved_at: Some("1234567890".to_string()),
            manifest_path: "sample-projects/tianwen-2/project.json".to_string(),
            manifest: json!({ "id": "tianwen-2", "name": "天问二号探测器样例项目", "caseName": "天问二号探测器案例" }),
            source_materials: vec![
                json!({ "id": "tw2-source", "title": "材料", "path": "sample-projects/tianwen-2/materials/source-material.md" }),
            ],
            model_artifacts: sample_model_artifacts(),
            confirmed_data: None,
            generated_artifacts: Some(json!({
                "validation": { "valid": true, "errors": [], "findings": [] }
            })),
            sidecar_draft: None,
            agent_trace_sessions: None,
            last_exported_bundle: None,
            files: vec![
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/project.json".to_string(),
                    content: "{}".to_string(),
                    media_type: "application/json".to_string(),
                },
                sample_sysml_file(
                    "model.sysml",
                    "package Tianwen2ConfirmedModel { package model_entry; }",
                ),
                sample_sysml_file(
                    "requirements.sysml",
                    "package Tianwen2ConfirmedModel { package requirements_view; }",
                ),
                sample_sysml_file(
                    "structure.sysml",
                    "package Tianwen2ConfirmedModel { package structure_view; }",
                ),
                sample_sysml_file(
                    "behavior.sysml",
                    "package Tianwen2ConfirmedModel { package behavior_view; }",
                ),
                sample_sysml_file(
                    "constraints.sysml",
                    "package Tianwen2ConfirmedModel { package constraints_view; }",
                ),
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/model/view-model.json".to_string(),
                    content: json!({
                        "schemaVersion": "0.4.0",
                        "projectId": "tianwen-2",
                        "source": "sysml-source-set-derived",
                        "generatedFrom": "Tianwen2ConfirmedModel",
                        "views": [],
                        "validation": { "status": "passed", "checkedRules": [] }
                    })
                    .to_string(),
                    media_type: "application/json".to_string(),
                },
            ],
        };

        let bundle = build_project_export_bundle(&saved_project)
            .expect("bundle should build from saved project");
        assert!(bundle.artifacts.iter().all(|artifact| !matches!(
            artifact.artifact_type.as_str(),
            "source-code" | "desktop-app"
        )));
        assert_eq!(
            bundle
                .checklist
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "saved-project",
                "model-source",
                "view-model",
                "validation",
                "export-manifest"
            ]
        );
        let mut planned_sysml_paths = bundle
            .artifacts
            .iter()
            .filter(|artifact| artifact.artifact_type == "sysml-v2")
            .map(|artifact| artifact.path.clone())
            .collect::<Vec<_>>();
        planned_sysml_paths.sort();
        assert_eq!(
            planned_sysml_paths,
            vec![
                "project/tianwen-2/sample-projects/tianwen-2/model/behavior.sysml".to_string(),
                "project/tianwen-2/sample-projects/tianwen-2/model/constraints.sysml".to_string(),
                "project/tianwen-2/sample-projects/tianwen-2/model/model.sysml".to_string(),
                "project/tianwen-2/sample-projects/tianwen-2/model/requirements.sysml".to_string(),
                "project/tianwen-2/sample-projects/tianwen-2/model/structure.sysml".to_string(),
            ]
        );

        let export_root = temp_export_root();
        fs::create_dir_all(&export_root).expect("temp export root should exist");

        for expected_path in [
            "project/tianwen-2/sample-projects/tianwen-2/model/model.sysml",
            "project/tianwen-2/sample-projects/tianwen-2/model/requirements.sysml",
            "project/tianwen-2/sample-projects/tianwen-2/model/structure.sysml",
            "project/tianwen-2/sample-projects/tianwen-2/model/behavior.sysml",
            "project/tianwen-2/sample-projects/tianwen-2/model/constraints.sysml",
            "project/tianwen-2/sample-projects/tianwen-2/model/view-model.json",
            "project/tianwen-2/sample-projects/tianwen-2/model/validation-result.json",
            "export/manifest.json",
        ] {
            let artifact = bundle
                .artifacts
                .iter()
                .find(|candidate| candidate.path == expected_path)
                .expect("artifact path should match planned export layout");
            write_text_artifact(&export_root, artifact)
                .expect("artifact should write to its declared path");
            assert!(export_root.join(PathBuf::from(expected_path)).exists());
        }

        let _ = fs::remove_dir_all(export_root);
    }
    #[test]
    fn planned_export_marks_missing_sysml_files_without_failing() {
        let mut saved_project = SavedWorkbenchProjectState {
            project_root: Some("local/project-root".to_string()),
            saved_at: Some("1234567890".to_string()),
            manifest_path: "sample-projects/tianwen-2/project.json".to_string(),
            manifest: json!({ "id": "tianwen-2", "name": "天问二号探测器样例项目", "caseName": "天问二号探测器案例" }),
            source_materials: vec![
                json!({ "id": "tw2-source", "title": "材料", "path": "sample-projects/tianwen-2/materials/source-material.md" }),
            ],
            model_artifacts: sample_model_artifacts(),
            confirmed_data: None,
            generated_artifacts: Some(json!({
                "validation": { "valid": true, "errors": [], "findings": [] }
            })),
            sidecar_draft: None,
            agent_trace_sessions: None,
            last_exported_bundle: None,
            files: vec![
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/project.json".to_string(),
                    content: "{}".to_string(),
                    media_type: "application/json".to_string(),
                },
                sample_sysml_file(
                    "model.sysml",
                    "package Tianwen2ConfirmedModel { package model_entry; }",
                ),
                sample_sysml_file(
                    "requirements.sysml",
                    "package Tianwen2ConfirmedModel { package requirements_view; }",
                ),
                sample_sysml_file(
                    "behavior.sysml",
                    "package Tianwen2ConfirmedModel { package behavior_view; }",
                ),
                sample_sysml_file(
                    "constraints.sysml",
                    "package Tianwen2ConfirmedModel { package constraints_view; }",
                ),
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/model/view-model.json".to_string(),
                    content: json!({
                        "schemaVersion": "0.4.0",
                        "projectId": "tianwen-2",
                        "source": "sysml-source-set-derived",
                        "generatedFrom": "Tianwen2ConfirmedModel",
                        "views": [],
                        "validation": { "status": "passed", "checkedRules": [] }
                    })
                    .to_string(),
                    media_type: "application/json".to_string(),
                },
            ],
        };

        saved_project
            .files
            .retain(|file| file.path != "sample-projects/tianwen-2/model/structure.sysml");

        let bundle = build_project_export_bundle(&saved_project)
            .expect("missing sysml source file should not block planned export bundle");
        let structure_artifact = bundle
            .artifacts
            .iter()
            .find(|artifact| {
                artifact.path == "project/tianwen-2/sample-projects/tianwen-2/model/structure.sysml"
            })
            .expect("missing sysml file should still have planned export artifact");
        let model_source_checklist = bundle
            .checklist
            .iter()
            .find(|item| item.id == "model-source")
            .expect("model-source checklist item should exist");

        assert_eq!(structure_artifact.status, "missing");
        assert!(structure_artifact.content.is_empty());
        assert!(structure_artifact
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("structure.sysml")));
        assert_eq!(model_source_checklist.status, "missing");
    }

    #[test]
    fn planned_export_without_any_sysml_artifacts_marks_model_source_missing() {
        let saved_project = SavedWorkbenchProjectState {
            project_root: Some("local/project-root".to_string()),
            saved_at: Some("1234567890".to_string()),
            manifest_path: "sample-projects/tianwen-2/project.json".to_string(),
            manifest: json!({ "id": "tianwen-2", "name": "天问二号探测器样例项目", "caseName": "天问二号探测器案例" }),
            source_materials: vec![
                json!({ "id": "tw2-source", "title": "材料", "path": "sample-projects/tianwen-2/materials/source-material.md" }),
            ],
            model_artifacts: sample_model_artifacts()
                .into_iter()
                .filter(|artifact| artifact.get("kind").and_then(Value::as_str) != Some("sysml-v2"))
                .collect(),
            confirmed_data: None,
            generated_artifacts: Some(json!({
                "validation": { "valid": true, "errors": [], "findings": [] }
            })),
            sidecar_draft: None,
            agent_trace_sessions: None,
            last_exported_bundle: None,
            files: vec![
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/project.json".to_string(),
                    content: "{}".to_string(),
                    media_type: "application/json".to_string(),
                },
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/model/view-model.json".to_string(),
                    content: json!({
                        "schemaVersion": "0.4.0",
                        "projectId": "tianwen-2",
                        "source": "sysml-source-set-derived",
                        "generatedFrom": "Tianwen2ConfirmedModel",
                        "views": [],
                        "validation": { "status": "passed", "checkedRules": [] }
                    })
                    .to_string(),
                    media_type: "application/json".to_string(),
                },
            ],
        };

        let bundle = build_project_export_bundle(&saved_project)
            .expect("zero sysml artifacts should still yield planned export bundle");
        let model_source_checklist = bundle
            .checklist
            .iter()
            .find(|item| item.id == "model-source")
            .expect("model-source checklist item should exist");

        assert_eq!(
            bundle
                .artifacts
                .iter()
                .filter(|artifact| artifact.artifact_type == "sysml-v2")
                .count(),
            0
        );
        assert_eq!(model_source_checklist.status, "missing");
    }

    #[test]
    fn export_materialization_produces_a_restorable_project_package() {
        let saved_project = SavedWorkbenchProjectState {
            project_root: Some("local/project-root".to_string()),
            saved_at: Some("1234567890".to_string()),
            manifest_path: "sample-projects/tianwen-2/project.json".to_string(),
            manifest: json!({ "id": "tianwen-2", "name": "天问二号探测器样例项目", "caseName": "天问二号探测器案例" }),
            source_materials: vec![
                json!({ "id": "tw2-source", "title": "材料", "path": "sample-projects/tianwen-2/materials/source-material.md" }),
            ],
            model_artifacts: sample_model_artifacts(),
            confirmed_data: Some(json!({ "projectId": "tianwen-2", "mission": "sample-return" })),
            generated_artifacts: Some(json!({
                "validation": { "valid": true, "errors": [], "findings": [] }
            })),
            sidecar_draft: None,
            agent_trace_sessions: Some(json!([{ "sessionId": "trace-session", "events": [] }])),
            last_exported_bundle: None,
            files: vec![
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/project.json".to_string(),
                    content: "{}".to_string(),
                    media_type: "application/json".to_string(),
                },
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/materials/source-material.md".to_string(),
                    content: "天问二号任务材料".to_string(),
                    media_type: "text/markdown".to_string(),
                },
                sample_sysml_file(
                    "model.sysml",
                    "package Tianwen2ConfirmedModel { package model_entry; }",
                ),
                sample_sysml_file(
                    "requirements.sysml",
                    "package Tianwen2ConfirmedModel { package requirements_view; }",
                ),
                sample_sysml_file(
                    "structure.sysml",
                    "package Tianwen2ConfirmedModel { package structure_view; }",
                ),
                sample_sysml_file(
                    "behavior.sysml",
                    "package Tianwen2ConfirmedModel { package behavior_view; }",
                ),
                sample_sysml_file(
                    "constraints.sysml",
                    "package Tianwen2ConfirmedModel { package constraints_view; }",
                ),
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/model/view-model.json".to_string(),
                    content: json!({
                        "schemaVersion": "0.4.0",
                        "projectId": "tianwen-2",
                        "source": "sysml-source-set-derived",
                        "generatedFrom": "Tianwen2ConfirmedModel",
                        "views": [],
                        "validation": { "status": "passed", "checkedRules": [] }
                    })
                    .to_string(),
                    media_type: "application/json".to_string(),
                },
            ],
        };

        let mut bundle = build_project_export_bundle(&saved_project)
            .expect("planned export bundle should still build");
        let export_root = temp_export_root();
        fs::create_dir_all(&export_root).expect("temp export root should exist");

        for artifact in &mut bundle.artifacts {
            let write_result = materialize_export_artifact(&saved_project, &export_root, artifact);
            match write_result {
                Ok(true) => {
                    artifact.status = "included".to_string();
                    artifact.detail = None;
                }
                Ok(false) => {}
                Err(error) => {
                    artifact.status = "missing".to_string();
                    artifact.detail = Some(error);
                }
            }
        }
        bundle.checklist = rebuild_checklist(&bundle.artifacts, &bundle.checklist);

        assert!(bundle
            .artifacts
            .iter()
            .all(|artifact| artifact.status == "included"));
        assert!(bundle
            .checklist
            .iter()
            .all(|item| item.status == "included"));
        assert!(export_root
            .join(PathBuf::from(
                "project/tianwen-2/sample-projects/tianwen-2/model/model.sysml",
            ))
            .exists());
        let exported_project_root = export_root.join(PathBuf::from("project/tianwen-2"));
        let restored_state_content =
            fs::read_to_string(exported_project_root.join(WORKBENCH_STATE_FILE))
                .expect("exported project package should contain restorable state");
        let restored_state: SavedWorkbenchProjectState =
            serde_json::from_str(&restored_state_content)
                .expect("exported project state should deserialize");
        assert_eq!(restored_state.manifest, saved_project.manifest);
        assert_eq!(restored_state.manifest_path, saved_project.manifest_path);
        assert_eq!(
            restored_state.source_materials,
            saved_project.source_materials
        );
        assert_eq!(
            restored_state.model_artifacts,
            saved_project.model_artifacts
        );
        assert_eq!(restored_state.confirmed_data, saved_project.confirmed_data);
        assert_eq!(
            restored_state.agent_trace_sessions,
            saved_project.agent_trace_sessions
        );
        assert!(restored_state.project_root.is_none());
        assert!(exported_project_root
            .join(&restored_state.manifest_path)
            .exists());
        for file in &restored_state.files {
            let exported_content = fs::read_to_string(exported_project_root.join(&file.path))
                .expect(
                "every restored state file should exist at the path recorded in the project state",
            );
            assert_eq!(exported_content, file.content);
        }

        let _ = fs::remove_dir_all(export_root);
    }

    fn sample_model_artifacts() -> Vec<Value> {
        vec![
            json!({
                "id": "tw2-model-entry-sysml",
                "title": "模型入口 SysML v2 源文件",
                "kind": "sysml-v2",
                "path": "sample-projects/tianwen-2/model/model.sysml"
            }),
            json!({
                "id": "tw2-model-requirements-sysml",
                "title": "需求 SysML v2 源文件",
                "kind": "sysml-v2",
                "path": "sample-projects/tianwen-2/model/requirements.sysml"
            }),
            json!({
                "id": "tw2-model-structure-sysml",
                "title": "结构 SysML v2 源文件",
                "kind": "sysml-v2",
                "path": "sample-projects/tianwen-2/model/structure.sysml"
            }),
            json!({
                "id": "tw2-model-behavior-sysml",
                "title": "行为 SysML v2 源文件",
                "kind": "sysml-v2",
                "path": "sample-projects/tianwen-2/model/behavior.sysml"
            }),
            json!({
                "id": "tw2-model-constraints-sysml",
                "title": "约束 SysML v2 源文件",
                "kind": "sysml-v2",
                "path": "sample-projects/tianwen-2/model/constraints.sysml"
            }),
            json!({
                "id": "tw2-view-model",
                "title": "JSON 视图模型",
                "kind": "json-view-model",
                "path": "sample-projects/tianwen-2/model/view-model.json"
            }),
        ]
    }

    fn sample_sysml_file(relative_path: &str, content: &str) -> PersistedProjectFile {
        PersistedProjectFile {
            path: format!("sample-projects/tianwen-2/model/{}", relative_path),
            content: content.to_string(),
            media_type: "text/x-sysml".to_string(),
        }
    }

    static TEMP_EXPORT_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_export_root() -> PathBuf {
        let suffix = TEMP_EXPORT_COUNTER.fetch_add(1, Ordering::Relaxed);
        env::temp_dir().join(format!(
            "mbse-course-practice-export-{}-{}",
            std::process::id(),
            suffix
        ))
    }
}
