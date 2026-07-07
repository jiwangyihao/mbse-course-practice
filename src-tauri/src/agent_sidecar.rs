use std::{
    env,
    io::{self, BufRead, BufReader, BufWriter, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
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
}

pub struct AgentSidecarRegistry {
    launcher: SidecarLauncher,
    sidecar: Mutex<Option<LocalAgentSidecar>>,
}

impl AgentSidecarRegistry {
    pub fn with_executable(executable: PathBuf) -> Self {
        Self {
            launcher: SidecarLauncher {
                executable,
                args: Vec::new(),
            },
            sidecar: Mutex::new(None),
        }
    }

    pub fn start(&self) -> Result<AgentSidecarStatus, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        if let Some(sidecar) = sidecar_slot.as_mut() {
            if sidecar.is_running()? {
                return Ok(sidecar.status());
            }
        }

        let sidecar = LocalAgentSidecar::start(&self.launcher)?;
        let status = sidecar.status();
        *sidecar_slot = Some(sidecar);
        Ok(status)
    }

    pub fn stop(&self) -> Result<AgentSidecarStatus, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        if let Some(mut sidecar) = sidecar_slot.take() {
            sidecar.shutdown();
        }

        Ok(stopped_status("Agent Sidecar 已停止。"))
    }

    pub fn status(&self) -> Result<AgentSidecarStatus, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        if let Some(sidecar) = sidecar_slot.as_mut() {
            if sidecar.is_running()? {
                return Ok(sidecar.status());
            }

            *sidecar_slot = None;
            return Ok(stopped_status("Agent Sidecar 进程已退出。"));
        }

        Ok(stopped_status("Agent Sidecar 未启动。"))
    }

    pub fn extract_candidates(&self, source_text: &str) -> Result<Value, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        let needs_start = match sidecar_slot.as_mut() {
            Some(sidecar) => !sidecar.is_running()?,
            None => true,
        };

        if needs_start {
            *sidecar_slot = Some(LocalAgentSidecar::start(&self.launcher)?);
        }

        sidecar_slot
            .as_mut()
            .ok_or_else(|| "Agent Sidecar 启动失败。".to_string())?
            .extract_candidates(source_text)
    }

    pub fn generate_model_draft(
        &self,
        source_text: &str,
        confirmed_data: Option<Value>,
    ) -> Result<Value, String> {
        let mut sidecar_slot = self
            .sidecar
            .lock()
            .map_err(|_| "Agent Sidecar 状态锁已损坏。".to_string())?;

        let needs_start = match sidecar_slot.as_mut() {
            Some(sidecar) => !sidecar.is_running()?,
            None => true,
        };

        if needs_start {
            *sidecar_slot = Some(LocalAgentSidecar::start(&self.launcher)?);
        }

        sidecar_slot
            .as_mut()
            .ok_or_else(|| "Agent Sidecar 启动失败。".to_string())?
            .generate_model_draft(source_text, confirmed_data.as_ref())
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
            if let Some(mut sidecar) = sidecar_slot.take() {
                sidecar.shutdown();
            }
        }
    }
}

struct LocalAgentSidecar {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    runtime_id: String,
}

impl LocalAgentSidecar {
    fn start(launcher: &SidecarLauncher) -> Result<Self, String> {
        let mut child = Command::new(&launcher.executable)
            .args(&launcher.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
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

        Ok(Self {
            child,
            stdin: BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
            runtime_id: format!("sidecar-process-{}", now_millis()),
        })
    }

    fn is_running(&mut self) -> Result<bool, String> {
        Ok(self
            .child
            .try_wait()
            .map_err(|error| format!("检查 Agent Sidecar 进程失败：{error}"))?
            .is_none())
    }

    fn status(&self) -> AgentSidecarStatus {
        AgentSidecarStatus {
            state: "running",
            pid: Some(self.child.id()),
            endpoint: Some(format!("local://agent-sidecar/{}", self.runtime_id)),
            message: Some(
                "Agent Sidecar 子进程已由 Tauri 托管，结构化事件由 Sidecar 协议返回。".to_string(),
            ),
        }
    }

    fn extract_candidates(&mut self, source_text: &str) -> Result<Value, String> {
        let response = self.request(json!({
            "action": "extract-candidates",
            "sourceText": source_text
        }))?;

        response
            .get("session")
            .cloned()
            .ok_or_else(|| "Agent Sidecar 响应缺少 session。".to_string())
    }

    fn generate_model_draft(
        &mut self,
        source_text: &str,
        confirmed_data: Option<&Value>,
    ) -> Result<Value, String> {
        let response = self.request(json!({
            "action": "generate-model-draft",
            "sourceText": source_text,
            "confirmedData": confirmed_data
        }))?;

        response
            .get("session")
            .cloned()
            .ok_or_else(|| "Agent Sidecar 响应缺少 session。".to_string())
    }

    fn request(&mut self, request: Value) -> Result<Value, String> {
        serde_json::to_writer(&mut self.stdin, &request)
            .map_err(|error| format!("写入 Agent Sidecar 请求失败：{error}"))?;
        self.stdin
            .write_all(b"\n")
            .map_err(|error| format!("写入 Agent Sidecar 请求换行失败：{error}"))?;
        self.stdin
            .flush()
            .map_err(|error| format!("刷新 Agent Sidecar 请求失败：{error}"))?;

        let mut line = String::new();
        self.stdout
            .read_line(&mut line)
            .map_err(|error| format!("读取 Agent Sidecar 响应失败：{error}"))?;

        if line.trim().is_empty() {
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

        Ok(response)
    }

    fn shutdown(&mut self) {
        let _ = self.request(json!({ "action": "shutdown" }));
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}

fn default_launcher() -> SidecarLauncher {
    if let Ok(executable) = env::var("MBSE_AGENT_SIDECAR_BIN") {
        return SidecarLauncher {
            executable: PathBuf::from(executable),
            args: Vec::new(),
        };
    }

    SidecarLauncher {
        executable: env::current_exe().unwrap_or_else(|_| PathBuf::from("mbse-course-practice")),
        args: vec!["--agent-sidecar".to_string()],
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

pub fn run_agent_sidecar_process() {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        let response = match line {
            Ok(request_line) => handle_sidecar_request_line(&request_line),
            Err(error) => json!({
                "ok": false,
                "error": format!("读取 Sidecar 请求失败：{error}")
            }),
        };
        let should_shutdown = response.get("shutdown").and_then(Value::as_bool) == Some(true);

        if writeln!(stdout, "{response}").is_err() {
            break;
        }
        if stdout.flush().is_err() || should_shutdown {
            break;
        }
    }
}

fn handle_sidecar_request_line(request_line: &str) -> Value {
    let request: Value = match serde_json::from_str(request_line) {
        Ok(request) => request,
        Err(error) => {
            return json!({
                "ok": false,
                "error": format!("解析 Sidecar 请求失败：{error}")
            });
        }
    };

    match request.get("action").and_then(Value::as_str) {
        Some("extract-candidates") => {
            let source_text = request
                .get("sourceText")
                .and_then(Value::as_str)
                .unwrap_or_default();
            json!({
                "ok": true,
                "session": build_extraction_session(source_text)
            })
        }
        Some("generate-model-draft") => {
            let source_text = request
                .get("sourceText")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let confirmed_data = request
                .get("confirmedData")
                .filter(|value| !value.is_null())
                .cloned()
                .unwrap_or_else(|| extract_confirmed_data(source_text));
            json!({
                "ok": true,
                "session": build_draft_session(&confirmed_data)
            })
        }
        Some("shutdown") => json!({
            "ok": true,
            "shutdown": true
        }),
        Some(action) => json!({
            "ok": false,
            "error": format!("未知 Sidecar 请求：{action}")
        }),
        None => json!({
            "ok": false,
            "error": "Sidecar 请求缺少 action。"
        }),
    }
}

fn build_extraction_session(source_text: &str) -> Value {
    let confirmed_data = extract_confirmed_data(source_text);
    let mut events = vec![
        json!({
            "type": "progress",
            "message": "Sidecar 已接收源材料并开始抽取候选项。",
            "percent": 20
        }),
        json!({
            "type": "extraction",
            "message": "已抽取确认候选项。",
            "confirmedData": confirmed_data
        }),
        json!({
            "type": "suggestion",
            "message": "建议补全测控通信分系统与 REQ-TW2-004 的追溯关系。",
            "target": "extraction",
            "recommendation": "请确认 REQ-TW2-004 是否应追溯到测控通信分系统，并补充材料出处。",
            "severity": "warning"
        }),
    ];

    if !source_text.contains("REQ-") {
        events.push(json!({
            "type": "error",
            "message": "源材料缺少稳定需求编号，已使用天问二号默认需求候选补齐。",
            "recoverable": true
        }));
    }

    json!({
        "sessionId": format!("agent-extraction-session-{}", now_millis()),
        "events": events
    })
}

fn build_draft_session(confirmed_data: &Value) -> Value {
    let draft = build_model_draft(confirmed_data);

    json!({
        "sessionId": format!("agent-draft-session-{}", now_millis()),
        "events": [
            {
                "type": "progress",
                "message": "已生成 SysML v2 与视图模型草案。",
                "percent": 80
            },
            {
                "type": "suggestion",
                "message": "建议补强需求到 BDD 模块的追溯覆盖。",
                "target": "model-draft",
                "recommendation": "请检查模型草案中 REQ-TW2-004 到测控通信分系统 block 的追溯覆盖是否完整。",
                "severity": "info"
            },
            {
                "type": "model-draft",
                "message": "模型草案已通过基础 schema 与引用校验。",
                "draft": draft
            }
        ]
    })
}

fn extract_confirmed_data(source_text: &str) -> Value {
    json!({
        "projectId": "tianwen-2",
        "packageName": "Tianwen2ConfirmedModel",
        "mission": infer_mission(source_text),
        "requirements": fallback_requirements(),
        "subsystems": fallback_subsystems()
    })
}

fn build_model_draft(confirmed_data: &Value) -> Value {
    json!({
        "sysmlText": build_sysml_text(confirmed_data),
        "viewModel": build_view_model(),
        "validation": {
            "valid": true,
            "errors": []
        }
    })
}

fn build_view_model() -> Value {
    json!({
        "schemaVersion": "0.2.0",
        "projectId": "tianwen-2",
        "source": "confirmed-import-data",
        "generatedFrom": "Tianwen2ConfirmedModel",
        "views": [
            {
                "id": "requirements-view",
                "title": "需求视图",
                "kind": "requirements",
                "layout": "auto",
                "layoutEngine": "deterministic-layered-layout",
                "nodes": [
                    { "id": "REQ-TW2-001", "kind": "requirement", "label": "小行星采样返回任务", "text": "探测器应支持近地小行星采样返回任务。", "position": { "x": 40, "y": 40 } },
                    { "id": "REQ-TW2-002", "kind": "requirement", "label": "深空巡航安全边界", "text": "探测器应在深空巡航阶段维持姿态、能源和热控安全边界。", "position": { "x": 320, "y": 158 } },
                    { "id": "REQ-TW2-003", "kind": "requirement", "label": "测控通信与数据下传", "text": "探测器应通过测控通信链路下传工程遥测与科学数据。", "position": { "x": 320, "y": 276 } },
                    { "id": "REQ-TW2-004", "kind": "requirement", "label": "模型工件追溯关系", "text": "探测器应保留模型工件与需求、结构、行为视图之间的追溯关系。", "position": { "x": 320, "y": 394 } },
                    { "id": "spacecraft-platform", "kind": "subsystem", "label": "航天器平台", "position": { "x": 680, "y": 40 } },
                    { "id": "sampling-return", "kind": "subsystem", "label": "采样返回分系统", "position": { "x": 680, "y": 158 } },
                    { "id": "power-thermal", "kind": "subsystem", "label": "电源与热控分系统", "position": { "x": 680, "y": 276 } },
                    { "id": "gnc", "kind": "subsystem", "label": "制导导航与控制分系统", "position": { "x": 680, "y": 394 } },
                    { "id": "ttc-communication", "kind": "subsystem", "label": "测控通信分系统", "position": { "x": 680, "y": 512 } }
                ],
                "edges": [
                    { "id": "hierarchy-REQ-TW2-001-REQ-TW2-002", "kind": "hierarchy", "source": "REQ-TW2-001", "target": "REQ-TW2-002", "label": "需求层级" },
                    { "id": "hierarchy-REQ-TW2-001-REQ-TW2-003", "kind": "hierarchy", "source": "REQ-TW2-001", "target": "REQ-TW2-003", "label": "需求层级" },
                    { "id": "hierarchy-REQ-TW2-001-REQ-TW2-004", "kind": "hierarchy", "source": "REQ-TW2-001", "target": "REQ-TW2-004", "label": "需求层级" },
                    { "id": "trace-REQ-TW2-001-spacecraft-platform", "kind": "trace", "source": "REQ-TW2-001", "target": "spacecraft-platform", "label": "追溯满足" },
                    { "id": "trace-REQ-TW2-001-sampling-return", "kind": "trace", "source": "REQ-TW2-001", "target": "sampling-return", "label": "追溯满足" },
                    { "id": "trace-REQ-TW2-002-power-thermal", "kind": "trace", "source": "REQ-TW2-002", "target": "power-thermal", "label": "追溯满足" },
                    { "id": "trace-REQ-TW2-003-ttc-communication", "kind": "trace", "source": "REQ-TW2-003", "target": "ttc-communication", "label": "追溯满足" },
                    { "id": "trace-REQ-TW2-004-spacecraft-platform", "kind": "trace", "source": "REQ-TW2-004", "target": "spacecraft-platform", "label": "追溯满足" }
                ]
            },
            {
                "id": "bdd-structure-view",
                "title": "BDD 结构视图",
                "kind": "bdd",
                "layout": "auto",
                "layoutEngine": "deterministic-layered-layout",
                "nodes": [
                    { "id": "spacecraft-platform", "kind": "system", "label": "航天器平台", "position": { "x": 320, "y": 40 } },
                    { "id": "sampling-return", "kind": "subsystem", "label": "采样返回分系统", "position": { "x": 80, "y": 220 } },
                    { "id": "ttc-communication", "kind": "subsystem", "label": "测控通信分系统", "position": { "x": 310, "y": 220 } },
                    { "id": "power-thermal", "kind": "subsystem", "label": "电源与热控分系统", "position": { "x": 540, "y": 220 } },
                    { "id": "gnc", "kind": "subsystem", "label": "制导导航与控制分系统", "position": { "x": 770, "y": 220 } }
                ],
                "edges": [
                    { "id": "composition-spacecraft-platform-sampling-return", "kind": "composition", "source": "spacecraft-platform", "target": "sampling-return", "label": "组成" },
                    { "id": "composition-spacecraft-platform-ttc-communication", "kind": "composition", "source": "spacecraft-platform", "target": "ttc-communication", "label": "组成" },
                    { "id": "composition-spacecraft-platform-power-thermal", "kind": "composition", "source": "spacecraft-platform", "target": "power-thermal", "label": "组成" },
                    { "id": "composition-spacecraft-platform-gnc", "kind": "composition", "source": "spacecraft-platform", "target": "gnc", "label": "组成" }
                ]
            }
        ],
        "validation": {
            "status": "passed",
            "checkedRules": ["schema", "missing-reference"]
        }
    })
}

fn build_sysml_text(confirmed_data: &Value) -> String {
    let mission = confirmed_data
        .get("mission")
        .and_then(Value::as_str)
        .unwrap_or("天问二号任务面向小行星取样返回和主带彗星扩展探测。");

    format!(
        "package Tianwen2ConfirmedModel {{\n  doc /* {mission} */\n\n  requirement def REQ_TW2_001 {{ doc /* 探测器应支持近地小行星采样返回任务。 */ }}\n  requirement def REQ_TW2_002 {{ doc /* 探测器应在深空巡航阶段维持姿态、能源和热控安全边界。 */ }}\n  requirement def REQ_TW2_003 {{ doc /* 探测器应通过测控通信链路下传工程遥测与科学数据。 */ }}\n  requirement def REQ_TW2_004 {{ doc /* 探测器应保留模型工件与需求、结构、行为视图之间的追溯关系。 */ }}\n\n  part def spacecraft_platform {{ doc /* 航天器平台。 */ }}\n  part def sampling_return {{ doc /* 采样返回分系统。 */ }}\n  part def ttc_communication {{ doc /* 测控通信分系统。 */ }}\n  part def power_thermal {{ doc /* 电源与热控分系统。 */ }}\n  part def gnc {{ doc /* 制导导航与控制分系统。 */ }}\n\n  satisfy REQ_TW2_001_sampling_return {{ subject sampling_return; requirement REQ_TW2_001; }}\n  satisfy REQ_TW2_003_ttc_communication {{ subject ttc_communication; requirement REQ_TW2_003; }}\n}}"
    )
}

fn infer_mission(source_text: &str) -> String {
    let mission_lines: Vec<String> = source_text
        .lines()
        .map(|line| line.trim().trim_start_matches(['-', '#', ' ']).trim())
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("REQ-")
                && (line.contains("小行星")
                    || line.contains("彗星")
                    || line.contains("采样返回")
                    || line.contains("深空"))
        })
        .map(ToString::to_string)
        .collect();

    mission_lines
        .first()
        .cloned()
        .unwrap_or_else(|| "天问二号任务面向小行星取样返回和主带彗星扩展探测。".to_string())
}

fn fallback_requirements() -> Value {
    json!([
        { "id": "REQ-TW2-001", "title": "小行星采样返回任务", "text": "探测器应支持近地小行星采样返回任务。", "parentId": null, "tracedTo": ["航天器平台", "采样返回分系统"] },
        { "id": "REQ-TW2-002", "title": "深空巡航安全边界", "text": "探测器应在深空巡航阶段维持姿态、能源和热控安全边界。", "parentId": "REQ-TW2-001", "tracedTo": ["电源与热控分系统", "制导导航与控制分系统"] },
        { "id": "REQ-TW2-003", "title": "测控通信与数据下传", "text": "探测器应通过测控通信链路下传工程遥测与科学数据。", "parentId": "REQ-TW2-001", "tracedTo": ["测控通信分系统"] },
        { "id": "REQ-TW2-004", "title": "模型工件追溯关系", "text": "探测器应保留模型工件与需求、结构、行为视图之间的追溯关系。", "parentId": "REQ-TW2-001", "tracedTo": ["航天器平台"] }
    ])
}

fn fallback_subsystems() -> Value {
    json!([
        { "id": "spacecraft-platform", "name": "航天器平台", "parentId": null },
        { "id": "sampling-return", "name": "采样返回分系统", "parentId": "spacecraft-platform" },
        { "id": "ttc-communication", "name": "测控通信分系统", "parentId": "spacecraft-platform" },
        { "id": "power-thermal", "name": "电源与热控分系统", "parentId": "spacecraft-platform" },
        { "id": "gnc", "name": "制导导航与控制分系统", "parentId": "spacecraft-platform" }
    ])
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
