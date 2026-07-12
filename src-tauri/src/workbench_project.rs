use std::{
    collections::HashMap,
    env,
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

    let normalized_files = project
        .files
        .iter()
        .map(|file| sanitize_persisted_file(file, &staging_root))
        .collect::<Result<Vec<_>, _>>()?;

    let manifest_present = normalized_files
        .iter()
        .any(|(_, file)| sanitize_relative_path(&file.path).ok() == Some(normalized_manifest_path.clone()));
    if !manifest_present {
        return Err(format!(
            "已保存项目缺少 manifestPath 对应文件：{}",
            project.manifest_path
        ));
    }

    for (path, file) in &normalized_files {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建项目文件目录失败：{error}"))?;
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

    let normalized_manifest_path = sanitize_relative_path(&project.manifest_path)?;
    let normalized_files = project
        .files
        .iter()
        .map(|file| sanitize_persisted_file(file, &project_root))
        .collect::<Result<Vec<_>, _>>()?;

    let manifest_present = normalized_files
        .iter()
        .any(|(_, file)| sanitize_relative_path(&file.path).ok() == Some(normalized_manifest_path.clone()));
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
    project.last_exported_bundle = normalize_project_export_bundle(project.last_exported_bundle.take(), &project)?;

    Ok(project)
}

pub fn export_workbench_project(
    app: &AppHandle,
    project_id: &str,
) -> Result<ProjectExportBundle, String> {
    let saved_project = load_workbench_project(app, project_id)?;
    let mut exported_bundle = build_project_export_bundle(&saved_project)?;
    let exports_root = saved_projects_root(app)?.join("exports");
    fs::create_dir_all(&exports_root)
        .map_err(|error| format!("创建交付根目录失败：{error}"))?;
    let export_root = exports_root.join(project_id);
    let project_root = saved_project_root(app, project_id)?;

    if export_root.exists() {
        fs::remove_dir_all(&export_root)
            .map_err(|error| format!("清理旧交付目录失败：{error}"))?;
    }
    fs::create_dir_all(&export_root)
        .map_err(|error| format!("创建交付目录失败：{error}"))?;

    exported_bundle.mode = "exported".to_string();
    exported_bundle.output_root = Some(path_string(&export_root));
    exported_bundle.exported_at = Some(now_millis_string());

    let repo_root = discover_repo_root();
    let release_binary = repo_root.as_ref().map(|root| {
        root.join("src-tauri")
            .join("target")
            .join("release")
            .join("mbse-course-practice.exe")
    });

    for artifact in &mut exported_bundle.artifacts {
        let write_result = match artifact.artifact_type.as_str() {
            "source-code" => match repo_root.as_ref() {
                Some(root) => copy_source_tree(root, &export_root, artifact),
                None => Err("未找到源码根目录，无法导出源码工程。".to_string()),
            },
            "desktop-app" => match release_binary.as_ref() {
                Some(binary) => copy_file_to_export(binary, &export_root, &artifact.path),
                None => Err("未找到 release 可执行文件，无法导出桌面应用。".to_string()),
            },
            "saved-project" => materialize_saved_project(&saved_project, &export_root, artifact),
            "export-manifest" => Ok(()),
            _ => write_text_artifact(&export_root, artifact),
        };

        match write_result {
            Ok(()) => {
                artifact.status = "included".to_string();
                artifact.detail = None;
            }
            Err(error) => {
                artifact.status = "missing".to_string();
                artifact.detail = Some(error);
            }
        }
    }

    exported_bundle.checklist = rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);

    let manifest_artifact_index = exported_bundle
        .artifacts
        .iter()
        .position(|artifact| artifact.artifact_type == "export-manifest");
    if let Some(index) = manifest_artifact_index {
        exported_bundle.artifacts[index].status = "included".to_string();
        exported_bundle.artifacts[index].detail = None;
        exported_bundle.checklist = rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);
        let manifest_content = build_export_manifest(&exported_bundle)?;
        exported_bundle.artifacts[index].content = manifest_content;

        let write_result = {
            let manifest_artifact = &exported_bundle.artifacts[index];
            write_text_artifact(&export_root, manifest_artifact)
        };

        if let Err(error) = write_result {
            exported_bundle.artifacts[index].status = "missing".to_string();
            exported_bundle.artifacts[index].detail = Some(error);
            exported_bundle.checklist = rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);
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

    exported_bundle.checklist = rebuild_checklist(&exported_bundle.artifacts, &exported_bundle.checklist);
    Ok(exported_bundle)
}

fn build_project_export_bundle(
    saved_project: &SavedWorkbenchProjectState,
) -> Result<ProjectExportBundle, String> {
    let project_id = read_project_id(&saved_project.manifest)?;
    let project_name = read_string(saved_project.manifest.get("name"), &project_id);

    let model_artifact_by_kind = saved_project
        .model_artifacts
        .iter()
        .filter_map(|artifact| {
            let kind = artifact.get("kind").and_then(Value::as_str)?;
            Some((kind.to_string(), artifact))
        })
        .collect::<HashMap<_, _>>();

    let sysml_artifact = model_artifact_by_kind.get("sysml-v2");
    let view_model_artifact = model_artifact_by_kind.get("json-view-model");
    let sysml_path = sysml_artifact
        .and_then(|artifact| artifact.get("path").and_then(Value::as_str))
        .ok_or_else(|| "已保存项目缺少 SysML v2 工件路径。".to_string())?;
    let view_model_path = view_model_artifact
        .and_then(|artifact| artifact.get("path").and_then(Value::as_str))
        .ok_or_else(|| "已保存项目缺少 JSON 视图模型工件路径。".to_string())?;
    let sysml_file = find_saved_file(saved_project, sysml_path)
        .ok_or_else(|| "已保存项目缺少 SysML v2 工件内容。".to_string())?;
    let view_model_file = find_saved_file(saved_project, view_model_path)
        .ok_or_else(|| "已保存项目缺少 JSON 视图模型内容。".to_string())?;

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

    let saved_project_path = format!("project/{project_id}");
    let artifacts = vec![
        ProjectExportArtifact {
            id: project_id.replace("tianwen-2", "tw2") + "-source-code",
            artifact_type: "source-code".to_string(),
            title: "源码工程".to_string(),
            path: "source/mbse-workbench".to_string(),
            source: saved_project.project_root.clone().unwrap_or_else(|| saved_project.manifest_path.clone()),
            required: true,
            status: "missing".to_string(),
            media_type: "application/json".to_string(),
            content: build_source_code_summary(&project_name),
            detail: Some("仅在导出命令实际复制源码后才会标记为 included。".to_string()),
        },
        ProjectExportArtifact {
            id: project_id.replace("tianwen-2", "tw2") + "-desktop-app",
            artifact_type: "desktop-app".to_string(),
            title: "桌面应用".to_string(),
            path: "runnable/mbse-workbench.exe".to_string(),
            source: saved_project.project_root.clone().unwrap_or_else(|| saved_project.manifest_path.clone()),
            required: true,
            status: "missing".to_string(),
            media_type: "application/json".to_string(),
            content: build_desktop_app_summary(&project_name),
            detail: Some("仅在导出命令实际复制桌面应用后才会标记为 included。".to_string()),
        },
        ProjectExportArtifact {
            id: project_id.replace("tianwen-2", "tw2") + "-saved-project",
            artifact_type: "saved-project".to_string(),
            title: "已保存项目快照".to_string(),
            path: saved_project_path.clone(),
            source: saved_project.manifest_path.clone(),
            required: true,
            status: "ready".to_string(),
            media_type: "application/json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "manifestPath": saved_project.manifest_path,
                "files": saved_project.files.iter().map(|file| json!({
                    "path": file.path,
                    "mediaType": file.media_type,
                })).collect::<Vec<_>>(),
            }))
            .map_err(|error| format!("序列化项目快照摘要失败：{error}"))?,
            detail: None,
        },
        ProjectExportArtifact {
            id: read_string(sysml_artifact.and_then(|artifact| artifact.get("id")), &format!("{project_id}-sysml")),
            artifact_type: "sysml-v2".to_string(),
            title: read_string(sysml_artifact.and_then(|artifact| artifact.get("title")), "SysML v2 模型文本"),
            path: format!("model/{project_id}.sysml"),
            source: sysml_path.to_string(),
            required: true,
            status: "ready".to_string(),
            media_type: "text/x-sysml".to_string(),
            content: sysml_file.content.clone(),
            detail: None,
        },
        ProjectExportArtifact {
            id: read_string(view_model_artifact.and_then(|artifact| artifact.get("id")), &format!("{project_id}-view-model")),
            artifact_type: "json-view-model".to_string(),
            title: read_string(view_model_artifact.and_then(|artifact| artifact.get("title")), "JSON 视图模型"),
            path: "model/view-model.json".to_string(),
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
            path: "model/validation-result.json".to_string(),
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
    ];

    let checklist = vec![
        build_checklist_item("source-code", "源码工程", &artifacts, &["source-code"]),
        build_checklist_item("desktop-app", "桌面应用", &artifacts, &["desktop-app"]),
        build_checklist_item("saved-project", "项目快照", &artifacts, &["saved-project"]),
        build_checklist_item("model-source", "SysML v2 文本", &artifacts, &["sysml-v2"]),
        build_checklist_item("view-model", "JSON 视图模型", &artifacts, &["json-view-model"]),
        build_checklist_item("validation", "validation 结果", &artifacts, &["validation-result"]),
        build_checklist_item("export-manifest", "导出清单", &artifacts, &["export-manifest"]),
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
    let artifact_ids = artifacts
        .iter()
        .filter(|artifact| types.contains(&artifact.artifact_type.as_str()))
        .map(|artifact| artifact.id.clone())
        .collect::<Vec<_>>();
    let status = if artifacts
        .iter()
        .filter(|artifact| types.contains(&artifact.artifact_type.as_str()))
        .all(|artifact| artifact.status == "included")
    {
        "included"
    } else if artifacts
        .iter()
        .filter(|artifact| types.contains(&artifact.artifact_type.as_str()))
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
    let sample_root = sanitize_relative_path(&artifact.path)?;
    for file in &saved_project.files {
        let file_path = sanitize_relative_path(&file.path)?;
        if !file_path.starts_with(&sample_root) {
            return Err(format!(
                "已保存项目文件 {} 不在样例工程根目录 {} 下。",
                file.path, artifact.path
            ));
        }
        let target_path = export_root.join(&file_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建样例工程目录失败：{error}"))?;
        }
        fs::write(&target_path, file.content.as_bytes())
            .map_err(|error| format!("写入样例工程文件 {} 失败：{error}", file.path))?;
    }
    Ok(())
}

fn copy_source_tree(
    repo_root: &Path,
    export_root: &Path,
    artifact: &ProjectExportArtifact,
) -> Result<(), String> {
    if !repo_root.join("package.json").exists() {
        return Err("未找到源码根目录，无法复制源码工程。".to_string());
    }

    let summary: Value = serde_json::from_str(&artifact.content)
        .map_err(|error| format!("解析源码工程导出计划失败：{error}"))?;
    let included_paths = summary
        .get("includedPaths")
        .and_then(Value::as_array)
        .ok_or_else(|| "源码工程导出计划缺少 includedPaths。".to_string())?;
    let target_root = export_root.join(sanitize_relative_path(&artifact.path)?);

    for entry in included_paths {
        let raw_path = entry
            .as_str()
            .ok_or_else(|| "源码工程 includedPaths 必须全部是字符串。".to_string())?;
        let relative_path = sanitize_relative_path(raw_path)?;
        let source_path = repo_root.join(&relative_path);
        if !source_path.exists() {
            return Err(format!("源码工程缺少声明路径：{}", raw_path));
        }
        copy_path(&source_path, &target_root.join(&relative_path))?;
    }

    Ok(())
}

fn copy_file_to_export(source_path: &Path, export_root: &Path, relative_path: &str) -> Result<(), String> {
    if !source_path.exists() {
        return Err(format!("缺少导出源文件：{}", source_path.display()));
    }

    let target_path = export_root.join(sanitize_relative_path(relative_path)?);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建导出文件目录失败：{error}"))?;
    }
    fs::copy(source_path, &target_path)
        .map_err(|error| format!("复制导出文件 {} 失败：{error}", source_path.display()))?;
    Ok(())
}

fn write_text_artifact(export_root: &Path, artifact: &ProjectExportArtifact) -> Result<(), String> {
    let target_path = export_root.join(sanitize_relative_path(&artifact.path)?);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建交付文件目录失败：{error}"))?;
    }
    fs::write(&target_path, artifact.content.as_bytes())
        .map_err(|error| format!("写入交付工件 {} 失败：{error}", artifact.title))?;
    Ok(())
}

fn copy_path(source_path: &Path, target_path: &Path) -> Result<(), String> {
    if source_path.is_dir() {
        if source_path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "target" || name == "dist" || name == "node_modules")
        {
            return Ok(());
        }

        fs::create_dir_all(target_path)
            .map_err(|error| format!("创建导出目录 {} 失败：{error}", target_path.display()))?;
        for entry in fs::read_dir(source_path)
            .map_err(|error| format!("读取目录 {} 失败：{error}", source_path.display()))?
        {
            let entry = entry.map_err(|error| format!("读取目录项失败：{error}"))?;
            copy_path(&entry.path(), &target_path.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建导出目录 {} 失败：{error}", parent.display()))?;
    }
    fs::copy(source_path, target_path)
        .map_err(|error| format!("复制文件 {} 失败：{error}", source_path.display()))?;
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

fn build_source_code_summary(project_name: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "title": format!("{project_name}源码工程"),
        "root": "source/mbse-workbench",
        "includedPaths": [
            "package.json",
            "package-lock.json",
            "tsconfig.json",
            "vite.config.ts",
            "vitest.config.ts",
            "index.html",
            "src/",
            "src-tauri/",
            "tests/",
            "sample-projects/",
            "docs/adr/",
        ],
        "purpose": "导出完整工作台源码，便于归档、复核运行环境与继续演化。",
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

fn build_desktop_app_summary(project_name: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "title": format!("{project_name}桌面应用"),
        "releaseSource": "src-tauri/target/release/mbse-course-practice.exe",
        "exportPath": "runnable/mbse-workbench.exe",
        "appShell": "Tauri 桌面壳",
        "managedProcess": "Agent Sidecar",
        "verification": [
            "打开导出的桌面应用",
            "确认应用可以加载已保存项目并展示多视图",
        ],
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

fn normalize_project_export_bundle(
    bundle: Option<ProjectExportBundle>,
    saved_project: &SavedWorkbenchProjectState,
) -> Result<Option<ProjectExportBundle>, String> {
    let Some(bundle) = bundle else {
        return Ok(None);
    };

    let requires_migration = bundle.artifacts.iter().any(|artifact| {
        normalize_legacy_export_artifact_type(&artifact.artifact_type).is_none()
            || is_legacy_only_export_artifact_type(&artifact.artifact_type)
    });
    if !requires_migration {
        return Ok(Some(bundle));
    }

    let planned_bundle = build_project_export_bundle(saved_project)?;
    let mut legacy_by_type = HashMap::new();
    for artifact in &bundle.artifacts {
        if let Some(normalized_type) = normalize_legacy_export_artifact_type(&artifact.artifact_type) {
            legacy_by_type
                .entry(normalized_type.to_string())
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
            if let Some(legacy_artifact) = legacy_by_type.get(&artifact.artifact_type) {
                let mut next_artifact = artifact.clone();
                next_artifact.status = normalize_export_artifact_status(&legacy_artifact.status).to_string();
                next_artifact.detail = legacy_artifact.detail.clone();
                next_artifact
            } else {
                artifact.clone()
            }
        })
        .collect();
    migrated_bundle.checklist = rebuild_checklist(&migrated_bundle.artifacts, &planned_bundle.checklist);
    if let Some(index) = migrated_bundle
        .artifacts
        .iter()
        .position(|artifact| artifact.artifact_type == "export-manifest")
    {
        migrated_bundle.artifacts[index].content = build_export_manifest(&migrated_bundle)?;
    }
    Ok(Some(migrated_bundle))
}

fn normalize_legacy_export_artifact_type(artifact_type: &str) -> Option<&'static str> {
    match artifact_type {
        "source-code" => Some("source-code"),
        "runnable-tauri-app" | "desktop-app" => Some("desktop-app"),
        "sample-project" | "saved-project" => Some("saved-project"),
        "sysml-v2" => Some("sysml-v2"),
        "json-view-model" => Some("json-view-model"),
        "validation-result" => Some("validation-result"),
        "delivery-manifest" | "export-manifest" => Some("export-manifest"),
        _ => None,
    }
}

fn is_legacy_only_export_artifact_type(artifact_type: &str) -> bool {
    matches!(artifact_type, "view-report" | "course-report-material" | "demo-guide")
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
    fs::create_dir_all(&root)
        .map_err(|error| format!("创建工作台数据根目录失败：{error}"))?;
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
            Component::RootDir | Component::Prefix(_) => return Err(format!("不允许绝对路径：{raw_path}")),
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

fn discover_repo_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir);
    }
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest_dir));
    }
    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in candidates {
        for ancestor in candidate.ancestors() {
            if ancestor.join("package.json").exists() && ancestor.join("src-tauri").join("Cargo.toml").exists() {
                return Some(ancestor.to_path_buf());
            }
        }
    }

    None
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


#[cfg(test)]
mod tests {
    use super::{
        build_project_export_bundle, sanitize_relative_path, write_text_artifact, PersistedProjectFile,
        SavedWorkbenchProjectState,
    };
    use serde_json::{json, Value};
    use std::{env, fs, path::PathBuf};

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
        let path = sanitize_relative_path("sample-projects/tianwen-2/model/view-model.json").expect("valid path");
        assert_eq!(path.to_string_lossy().replace('\\', "/"), "sample-projects/tianwen-2/model/view-model.json");
    }

    #[test]
    fn state_file_roundtrip_preserves_sidecar_draft() {
        let state = SavedWorkbenchProjectState {
            project_root: Some("local/project-root".to_string()),
            saved_at: Some("1234567890".to_string()),
            manifest_path: "sample-projects/tianwen-2/project.json".to_string(),
            manifest: json!({ "id": "tianwen-2", "name": "天问二号探测器样例项目" }),
            source_materials: vec![json!({ "id": "tw2-source", "title": "材料", "path": "sample-projects/tianwen-2/materials/source-material.md" })],
            model_artifacts: vec![json!({ "id": "tw2-sysml", "kind": "sysml-v2", "path": "sample-projects/tianwen-2/model/tianwen-2.sysml" })],
            confirmed_data: Some(json!({ "projectId": "tianwen-2" })),
            generated_artifacts: Some(json!({ "sysmlText": "package Tianwen2ConfirmedModel {}" })),
            sidecar_draft: Some(json!({ "sysmlText": "package DraftModel {}", "viewModel": { "views": [] } })),
            last_exported_bundle: None,
            files: vec![PersistedProjectFile {
                path: "sample-projects/tianwen-2/project.json".to_string(),
                content: "{}".to_string(),
                media_type: "application/json".to_string(),
            }],
        };

        let serialized = serde_json::to_string(&state).expect("state should serialize");
        let restored: SavedWorkbenchProjectState = serde_json::from_str(&serialized).expect("state should deserialize");

        assert_eq!(
            restored
                .sidecar_draft
                .as_ref()
                .and_then(|draft| draft.get("sysmlText"))
                .and_then(Value::as_str),
            Some("package DraftModel {}")
        );
    }

    #[test]
    fn planned_export_paths_match_written_artifact_locations() {
        let saved_project = SavedWorkbenchProjectState {
            project_root: Some("local/project-root".to_string()),
            saved_at: Some("1234567890".to_string()),
            manifest_path: "sample-projects/tianwen-2/project.json".to_string(),
            manifest: json!({ "id": "tianwen-2", "name": "天问二号探测器样例项目", "caseName": "天问二号探测器案例" }),
            source_materials: vec![json!({ "id": "tw2-source", "title": "材料", "path": "sample-projects/tianwen-2/materials/source-material.md" })],
            model_artifacts: vec![
                json!({ "id": "tw2-sysml", "title": "SysML v2 模型文本", "kind": "sysml-v2", "path": "sample-projects/tianwen-2/model/tianwen-2.sysml" }),
                json!({ "id": "tw2-view-model", "title": "JSON 视图模型", "kind": "json-view-model", "path": "sample-projects/tianwen-2/model/view-model.json" }),
            ],
            confirmed_data: None,
            generated_artifacts: Some(json!({
                "validation": { "valid": true, "errors": [], "findings": [] }
            })),
            sidecar_draft: None,
            last_exported_bundle: None,
            files: vec![
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/project.json".to_string(),
                    content: "{}".to_string(),
                    media_type: "application/json".to_string(),
                },
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/model/tianwen-2.sysml".to_string(),
                    content: "package Tianwen2ConfirmedModel {}".to_string(),
                    media_type: "text/x-sysml".to_string(),
                },
                PersistedProjectFile {
                    path: "sample-projects/tianwen-2/model/view-model.json".to_string(),
                    content: json!({
                        "schemaVersion": "0.4.0",
                        "projectId": "tianwen-2",
                        "source": "confirmed-import-data",
                        "generatedFrom": "Tianwen2ConfirmedModel",
                        "views": [],
                        "validation": { "status": "passed", "checkedRules": [] }
                    }).to_string(),
                    media_type: "application/json".to_string(),
                },
            ],
        };

        let bundle = build_project_export_bundle(&saved_project).expect("bundle should build from saved project");
        let export_root = temp_export_root();
        fs::create_dir_all(&export_root).expect("temp export root should exist");

        for expected_path in [
            "model/tianwen-2.sysml",
            "model/view-model.json",
            "model/validation-result.json",
            "export/manifest.json",
        ] {
            let artifact = bundle
                .artifacts
                .iter()
                .find(|candidate| candidate.path == expected_path)
                .expect("artifact path should match planned export layout");
            write_text_artifact(&export_root, artifact).expect("artifact should write to its declared path");
            assert!(export_root.join(PathBuf::from(expected_path)).exists());
        }

        let _ = fs::remove_dir_all(export_root);
    }

    fn temp_export_root() -> PathBuf {
        env::temp_dir().join(format!("mbse-course-practice-export-{}", std::process::id()))
    }
}
