use std::{
    env,
    io::{BufRead, BufReader, BufWriter, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSidecarStatus {
    pub state: &'static str,
    pub pid: Option<u32>,
    pub endpoint: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone)]
struct SidecarLauncher {
    executable: PathBuf,
    args: Vec<String>,
    resolution_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarPreflightStatus {
    provider: String,
    model: String,
    sdk_session_id: String,
    completed_at: String,
    fallback_message: Option<String>,
}

#[derive(Debug, Clone)]
struct SidecarRuntimeInfo {
    provider: String,
    model: String,
    sdk_session_id: String,
    completed_at: String,
    fallback_message: Option<String>,
}

impl From<SidecarPreflightStatus> for SidecarRuntimeInfo {
    fn from(value: SidecarPreflightStatus) -> Self {
        Self {
            provider: value.provider,
            model: value.model,
            sdk_session_id: value.sdk_session_id,
            completed_at: value.completed_at,
            fallback_message: value.fallback_message,
        }
    }
}

pub struct AgentSidecarRegistry {
    launcher: SidecarLauncher,
    sidecar: Mutex<Option<Arc<LocalAgentSidecar>>>,
}

impl AgentSidecarRegistry {
    pub fn with_executable(executable: PathBuf) -> Self {
        Self::with_launcher(executable, Vec::new())
    }

    pub fn with_launcher(executable: PathBuf, args: Vec<String>) -> Self {
        Self {
            launcher: SidecarLauncher {
                executable,
                args,
                resolution_error: None,
            },
            sidecar: Mutex::new(None),
        }
    }

    pub fn start(&self) -> Result<AgentSidecarStatus, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        if let Some(sidecar) = sidecar_slot.as_ref() {
            if sidecar.is_running()? {
                return sidecar.status();
            }
        }

        let sidecar = Arc::new(LocalAgentSidecar::start(&self.launcher)?);
        let status = sidecar.status()?;
        *sidecar_slot = Some(sidecar);
        Ok(status)
    }

    pub fn stop(&self) -> Result<AgentSidecarStatus, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        if let Some(sidecar) = sidecar_slot.take() {
            sidecar.shutdown();
        }

        Ok(stopped_status("Agent Sidecar 已停止。"))
    }

    pub fn status(&self) -> Result<AgentSidecarStatus, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        if let Some(sidecar) = sidecar_slot.as_ref() {
            if sidecar.is_running()? {
                return sidecar.status();
            }

            *sidecar_slot = None;
            return Ok(stopped_status("Agent Sidecar 进程已退出。"));
        }

        Ok(stopped_status("Agent Sidecar 未启动。"))
    }

    pub fn preflight(&self) -> Result<AgentSidecarStatus, String> {
        let sidecar = self.ensure_running_sidecar()?;
        sidecar.status()
    }

    pub fn extract_candidates(&self, source_text: &str) -> Result<Value, String> {
        self.extract_candidates_with_progress(source_text, |_| {})
    }

    pub fn extract_candidates_with_progress<F>(&self, source_text: &str, on_event: F) -> Result<Value, String>
    where
        F: FnMut(&Value),
    {
        let sidecar = self.ensure_running_sidecar()?;
        sidecar.extract_candidates_with_progress(source_text, on_event)
    }

    pub fn generate_model_draft(
        &self,
        source_text: &str,
        confirmed_data: Option<Value>,
    ) -> Result<Value, String> {
        self.generate_model_draft_with_progress(source_text, confirmed_data, |_| {})
    }

    pub fn generate_model_draft_with_progress<F>(
        &self,
        source_text: &str,
        confirmed_data: Option<Value>,
        on_event: F,
    ) -> Result<Value, String>
    where
        F: FnMut(&Value),
    {
        let sidecar = self.ensure_running_sidecar()?;
        sidecar.generate_model_draft_with_progress(source_text, confirmed_data.as_ref(), on_event)
    }

    fn ensure_running_sidecar(&self) -> Result<Arc<LocalAgentSidecar>, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        let needs_start = match sidecar_slot.as_ref() {
            Some(sidecar) => !sidecar.is_running()?,
            None => true,
        };

        if needs_start {
            *sidecar_slot = Some(Arc::new(LocalAgentSidecar::start(&self.launcher)?));
        }

        sidecar_slot
            .as_ref()
            .cloned()
            .ok_or_else(|| "Agent Sidecar 启动失败。".to_string())
    }
}

impl Default for AgentSidecarRegistry {
    fn default() -> Self {
        Self {
            launcher: default_launcher(),
            sidecar: Mutex::new(None),
        }
    }
}

impl Drop for AgentSidecarRegistry {
    fn drop(&mut self) {
        if let Ok(mut sidecar_slot) = self.sidecar.lock() {
            if let Some(sidecar) = sidecar_slot.take() {
                sidecar.shutdown();
            }
        }
    }
}

struct SidecarIo {
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

struct LocalAgentSidecar {
    child: Mutex<Child>,
    io: Mutex<SidecarIo>,
    runtime_id: String,
    runtime_info: Mutex<SidecarRuntimeInfo>,
}

impl LocalAgentSidecar {
    fn start(launcher: &SidecarLauncher) -> Result<Self, String> {
        if let Some(error) = launcher.resolution_error.as_ref() {
            return Err(error.clone());
        }

        let mut child = Command::new(&launcher.executable)
            .args(&launcher.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("启动 Agent Sidecar 可执行文件失败：{error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Agent Sidecar stdin 管道不可用。".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Agent Sidecar stdout 管道不可用。".to_string())?;

        let sidecar = Self {
            child: Mutex::new(child),
            io: Mutex::new(SidecarIo {
                stdin: BufWriter::new(stdin),
                stdout: BufReader::new(stdout),
            }),
            runtime_id: format!("sidecar-process-{}", now_millis()),
            runtime_info: Mutex::new(SidecarRuntimeInfo {
                provider: "unknown-provider".to_string(),
                model: "unknown-model".to_string(),
                sdk_session_id: "unknown-session".to_string(),
                completed_at: String::new(),
                fallback_message: None,
            }),
        };

        match sidecar.preflight() {
            Ok(info) => {
                *sidecar
                    .runtime_info
                    .lock()
                    .map_err(|_| "Agent Sidecar 运行时信息锁已损坏。".to_string())? = info;
                Ok(sidecar)
            }
            Err(error) => {
                sidecar.shutdown();
                Err(error)
            }
        }
    }

    fn preflight(&self) -> Result<SidecarRuntimeInfo, String> {
        let response = self.request(json!({ "action": "preflight" }), |_| {})?;
        let status = response
            .get("status")
            .cloned()
            .ok_or_else(|| "Agent Sidecar 预检响应缺少 status。".to_string())?;
        let parsed: SidecarPreflightStatus = serde_json::from_value(status)
            .map_err(|error| format!("解析 Agent Sidecar 预检状态失败：{error}"))?;
        Ok(parsed.into())
    }

    fn is_running(&self) -> Result<bool, String> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| "Agent Sidecar 子进程锁已损坏。".to_string())?;
        Ok(child
            .try_wait()
            .map_err(|error| format!("检查 Agent Sidecar 进程失败：{error}"))?
            .is_none())
    }

    fn status(&self) -> Result<AgentSidecarStatus, String> {
        let child = self
            .child
            .lock()
            .map_err(|_| "Agent Sidecar 子进程锁已损坏。".to_string())?;
        let runtime_info = self
            .runtime_info
            .lock()
            .map_err(|_| "Agent Sidecar 运行时信息锁已损坏。".to_string())?
            .clone();
        Ok(AgentSidecarStatus {
            state: "running",
            pid: Some(child.id()),
            endpoint: Some(format!("local://agent-sidecar/{}", self.runtime_id)),
            message: Some(runtime_status_message(&runtime_info)),
        })
    }

    fn extract_candidates_with_progress<F>(&self, source_text: &str, on_event: F) -> Result<Value, String>
    where
        F: FnMut(&Value),
    {
        let response = self.request(
            json!({
                "action": "extract-candidates",
                "sourceText": source_text
            }),
            on_event,
        )?;

        response
            .get("session")
            .cloned()
            .ok_or_else(|| "Agent Sidecar 响应缺少 session。".to_string())
    }

    fn generate_model_draft_with_progress<F>(
        &self,
        source_text: &str,
        confirmed_data: Option<&Value>,
        on_event: F,
    ) -> Result<Value, String>
    where
        F: FnMut(&Value),
    {
        let confirmed_data = confirmed_data.ok_or_else(|| {
            "generate-model-draft 缺少 confirmedData；已禁用任何本地补齐或确定性回退路径。".to_string()
        })?;
        let response = self.request(
            json!({
                "action": "generate-model-draft",
                "sourceText": source_text,
                "confirmedData": confirmed_data
            }),
            on_event,
        )?;

        response
            .get("session")
            .cloned()
            .ok_or_else(|| "Agent Sidecar 响应缺少 session。".to_string())
    }

    fn request<F>(&self, request: Value, mut on_event: F) -> Result<Value, String>
    where
        F: FnMut(&Value),
    {
        let mut io = self
            .io
            .lock()
            .map_err(|_| "Agent Sidecar IO 锁已损坏。".to_string())?;

        serde_json::to_writer(&mut io.stdin, &request)
            .map_err(|error| format!("写入 Agent Sidecar 请求失败：{error}"))?;
        io.stdin
            .write_all(b"\n")
            .map_err(|error| format!("写入 Agent Sidecar 请求换行失败：{error}"))?;
        io.stdin
            .flush()
            .map_err(|error| format!("刷新 Agent Sidecar 请求失败：{error}"))?;

        loop {
            let mut line = String::new();
            let read = io
                .stdout
                .read_line(&mut line)
                .map_err(|error| format!("读取 Agent Sidecar 响应失败：{error}"))?;

            if read == 0 || line.trim().is_empty() {
                return Err("Agent Sidecar 未返回结构化响应。".to_string());
            }

            let response: Value = serde_json::from_str(&line)
                .map_err(|error| format!("解析 Agent Sidecar 结构化响应失败：{error}"))?;

            if response.get("ok").and_then(Value::as_bool) == Some(false) {
                return Err(response
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent Sidecar 返回失败。")
                    .to_string());
            }

            if let Some(event) = response.get("event") {
                on_event(event);
                continue;
            }

            return Ok(response);
        }
    }

    fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
    }
}

fn runtime_status_message(runtime_info: &SidecarRuntimeInfo) -> String {
    let mut message = format!(
        "SDK Agent Sidecar 已就绪：{}/{}，最近预检会话 {}，完成于 {}。",
        runtime_info.provider, runtime_info.model, runtime_info.sdk_session_id, runtime_info.completed_at
    );
    if let Some(fallback) = runtime_info.fallback_message.as_ref() {
        if !fallback.trim().is_empty() {
            message.push_str(&format!(" 模型回退信息：{}", fallback.trim()));
        }
    }
    message
}

fn default_launcher() -> SidecarLauncher {
    if let Ok(executable) = env::var("MBSE_AGENT_SIDECAR_BIN") {
        return SidecarLauncher {
            executable: PathBuf::from(executable),
            args: Vec::new(),
            resolution_error: None,
        };
    }

    if cfg!(debug_assertions) {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|path| path.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        let script = project_root.join("sidecar").join("agent-sdk-sidecar.mjs");
        let resolution_error = if script.exists() {
            None
        } else {
            Some(format!(
                "开发模式下未找到 SDK Sidecar 脚本：{}",
                script.to_string_lossy()
            ))
        };
        return SidecarLauncher {
            executable: PathBuf::from("bun"),
            args: vec![script.to_string_lossy().into_owned()],
            resolution_error,
        };
    }

    SidecarLauncher {
        executable: PathBuf::new(),
        args: Vec::new(),
        resolution_error: Some(
            "未配置 bundled Agent Sidecar。打包模式必须提供受控 sidecar 资源或设置 MBSE_AGENT_SIDECAR_BIN。"
                .to_string(),
        ),
    }
}

fn stopped_status(message: &str) -> AgentSidecarStatus {
    AgentSidecarStatus {
        state: "stopped",
        pid: None,
        endpoint: None,
        message: Some(message.to_string()),
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
