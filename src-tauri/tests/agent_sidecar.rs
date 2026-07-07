use std::path::PathBuf;

use mbse_course_practice_lib::agent_sidecar::AgentSidecarRegistry;
use serde_json::Value;

fn sidecar_executable() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_agent_sidecar"))
}

#[test]
fn tauri_managed_sidecar_process_reports_running_and_stopped_status() {
    let registry = AgentSidecarRegistry::with_executable(sidecar_executable());

    let started = registry.start().expect("Sidecar should start");
    assert_eq!(started.state, "running");
    assert!(started.pid.is_some());
    assert_ne!(started.pid, Some(std::process::id()));
    assert!(started
        .endpoint
        .as_deref()
        .unwrap_or_default()
        .starts_with("local://agent-sidecar/"));

    let observed = registry.status().expect("Sidecar status should be readable");
    assert_eq!(observed.state, "running");
    assert_eq!(observed.pid, started.pid);

    let stopped = registry.stop().expect("Sidecar should stop");
    assert_eq!(stopped.state, "stopped");
    assert_eq!(stopped.pid, None);
}

#[test]
fn sidecar_process_returns_structured_events_for_extraction_progress_and_errors() {
    let registry = AgentSidecarRegistry::with_executable(sidecar_executable());
    registry.start().expect("Sidecar should start");

    let session = registry
        .extract_candidates("天问二号任务面向小行星取样返回和主带彗星探测。")
        .expect("Sidecar should extract candidates");
    let events = session
        .get("events")
        .and_then(Value::as_array)
        .expect("session should expose structured events");
    let event_types: Vec<&str> = events
        .iter()
        .filter_map(|event| event.get("type").and_then(Value::as_str))
        .collect();

    assert!(event_types.contains(&"progress"));
    assert!(event_types.contains(&"extraction"));
    assert!(event_types.contains(&"error"));
    assert!(!event_types.contains(&"model-draft"));
    assert!(events.iter().any(|event| event.get("confirmedData").is_some()));
    assert!(!events.iter().any(|event| event.get("draft").is_some()));
}

#[test]
fn sidecar_process_draft_reuses_requirements_and_bdd_view_model_contract() {
    let registry = AgentSidecarRegistry::with_executable(sidecar_executable());
    let confirmed_session = registry
        .extract_candidates("REQ-TW2-001：探测器应支持近地小行星采样返回任务。")
        .expect("Sidecar should extract candidates");
    let confirmed_data = confirmed_session["events"]
        .as_array()
        .and_then(|events| events.iter().find(|event| event["type"] == "extraction"))
        .and_then(|event| event.get("confirmedData"))
        .cloned();
    let session = registry
        .generate_model_draft("REQ-TW2-001：探测器应支持近地小行星采样返回任务。", confirmed_data)
        .expect("Sidecar should return draft after candidate confirmation");
    let draft = session["events"]
        .as_array()
        .and_then(|events| events.iter().find(|event| event["type"] == "model-draft"))
        .and_then(|event| event.get("draft"))
        .expect("model draft event should carry draft");
    let view_kinds: Vec<&str> = draft["viewModel"]["views"]
        .as_array()
        .expect("draft should expose views")
        .iter()
        .filter_map(|view| view.get("kind").and_then(Value::as_str))
        .collect();

    assert_eq!(draft["validation"]["valid"], true);
    assert!(view_kinds.contains(&"requirements"));
    assert!(view_kinds.contains(&"bdd"));
}
