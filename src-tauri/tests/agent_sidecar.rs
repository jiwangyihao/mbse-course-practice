use std::path::PathBuf;

use mbse_course_practice_lib::agent_sidecar::AgentSidecarRegistry;
use serde_json::Value;

fn sidecar_script() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root should exist")
        .join("sidecar")
        .join("test-fixtures")
        .join("mock-agent-sidecar.mjs")
        .to_string_lossy()
        .into_owned()
}

fn sidecar_registry() -> AgentSidecarRegistry {
    AgentSidecarRegistry::with_launcher(PathBuf::from("bun"), vec![sidecar_script()])
}

#[test]
fn tauri_managed_sidecar_process_reports_running_and_stopped_status() {
    let registry = sidecar_registry();

    let started = registry.start().expect("Sidecar should start");
    assert_eq!(started.state, "running");
    assert!(started.pid.is_some());
    assert_ne!(started.pid, Some(std::process::id()));
    assert!(started
        .endpoint
        .as_deref()
        .unwrap_or_default()
        .starts_with("local://agent-sidecar/"));
    assert!(started
        .message
        .as_deref()
        .unwrap_or_default()
        .contains("test-provider/test-model"));

    let observed = registry
        .status()
        .expect("Sidecar status should be readable");
    assert_eq!(observed.state, "running");
    assert_eq!(observed.pid, started.pid);

    let stopped = registry.stop().expect("Sidecar should stop");
    assert_eq!(stopped.state, "stopped");
    assert_eq!(stopped.pid, None);
}

#[test]
fn sidecar_process_returns_structured_events_for_extraction_progress_errors_and_suggestions() {
    let registry = sidecar_registry();
    registry.start().expect("Sidecar should start");

    let session = registry
        .extract_candidates("天问二号任务面向小行星取样返回和主带彗星探测。")
        .expect("Sidecar should extract candidates");
    assert_eq!(session.get("provider").and_then(Value::as_str), Some("test-provider"));
    assert_eq!(session.get("model").and_then(Value::as_str), Some("test-model"));
    let events = session
        .get("events")
        .and_then(Value::as_array)
        .expect("session should expose structured events");
    let event_types: Vec<&str> = events
        .iter()
        .filter_map(|event| event.get("type").and_then(Value::as_str))
        .collect();
    let suggestion = events
        .iter()
        .find(|event| event.get("type").and_then(Value::as_str) == Some("suggestion"))
        .expect("extraction session should include structured suggestion event");

    assert!(event_types.contains(&"progress"));
    assert!(event_types.contains(&"extraction"));
    assert!(event_types.contains(&"suggestion"));
    assert!(event_types.contains(&"error"));
    assert!(!event_types.contains(&"model-draft"));
    assert!(events
        .iter()
        .any(|event| event.get("confirmedData").is_some()));
    let error_event = events
        .iter()
        .find(|event| event.get("type").and_then(Value::as_str) == Some("error"))
        .expect("extraction session should include a recoverable error event for materials without requirement ids");
    assert_eq!(
        error_event.get("recoverable").and_then(Value::as_bool),
        Some(true)
    );
    assert!(!events.iter().any(|event| event.get("draft").is_some()));
    assert_eq!(
        suggestion.get("target").and_then(Value::as_str),
        Some("extraction"),
        "extraction suggestion should identify the target"
    );
    assert_eq!(
        suggestion.get("severity").and_then(Value::as_str),
        Some("warning")
    );
}

#[test]
fn sidecar_process_draft_reuses_requirements_and_bdd_view_model_contract() {
    let registry = sidecar_registry();
    let confirmed_session = registry
        .extract_candidates("REQ-TW2-001：探测器应支持近地小行星采样返回任务。")
        .expect("Sidecar should extract candidates");
    let confirmed_data = confirmed_session["events"]
        .as_array()
        .and_then(|events| events.iter().find(|event| event["type"] == "extraction"))
        .and_then(|event| event.get("confirmedData"))
        .cloned();
    let session = registry
        .generate_model_draft(
            "REQ-TW2-001：探测器应支持近地小行星采样返回任务。",
            confirmed_data,
        )
        .expect("Sidecar should return draft after candidate confirmation");
    let events = session["events"]
        .as_array()
        .expect("draft session should expose structured events");
    let event_types: Vec<&str> = events
        .iter()
        .filter_map(|event| event.get("type").and_then(Value::as_str))
        .collect();
    let suggestion = events
        .iter()
        .find(|event| event.get("type").and_then(Value::as_str) == Some("suggestion"))
        .expect("draft session should include structured suggestion event");
    let draft = events
        .iter()
        .find(|event| event["type"] == "model-draft")
        .and_then(|event| event.get("draft"))
        .expect("model draft event should carry draft");
    let view_kinds: Vec<&str> = draft["viewModel"]["views"]
        .as_array()
        .expect("draft should expose views")
        .iter()
        .filter_map(|view| view.get("kind").and_then(Value::as_str))
        .collect();

    assert!(event_types.contains(&"suggestion"));
    assert!(event_types.contains(&"model-draft"));
    assert!(!event_types.contains(&"extraction"));
    assert_eq!(
        suggestion.get("target").and_then(Value::as_str),
        Some("model-draft"),
        "draft suggestion should identify the model draft target"
    );
    assert_eq!(draft["validation"]["valid"], true);
    assert_eq!(
        draft["provenance"]["mode"].as_str(),
        Some("sdk-agent")
    );
    assert!(view_kinds.contains(&"requirements"));
    assert!(view_kinds.contains(&"bdd"));
}

#[test]
fn sidecar_process_rejects_draft_missing_bdd_view_kind() {
    let registry = sidecar_registry();
    let source_text = "REQ-TW2-001：探测器应支持近地小行星采样返回任务。 MISSING-BDD-VIEW-KIND";
    let confirmed_session = registry
        .extract_candidates(source_text)
        .expect("Sidecar should extract candidates for the invalid-draft scenario");
    let confirmed_data = confirmed_session["events"]
        .as_array()
        .and_then(|events| events.iter().find(|event| event["type"] == "extraction"))
        .and_then(|event| event.get("confirmedData"))
        .cloned();

    let error = registry
        .generate_model_draft(source_text, confirmed_data)
        .expect_err("Sidecar should reject a draft missing the BDD view kind");

    assert!(
        error.contains("$.views[1].kind"),
        "rejection should identify the missing BDD view field, got: {error}"
    );
    assert!(
        error.contains("schema 缺少 view.kind"),
        "rejection should preserve the schema validation reason, got: {error}"
    );
}

#[test]
fn stop_can_interrupt_an_inflight_sidecar_request() {
    let registry = std::sync::Arc::new(sidecar_registry());
    registry.start().expect("Sidecar should start");

    let request_registry = registry.clone();
    let handle = std::thread::spawn(move || request_registry.extract_candidates("SLOW-CANCEL"));

    std::thread::sleep(std::time::Duration::from_millis(50));
    let stopped = registry
        .stop()
        .expect("stop should succeed while a request is in flight");
    assert_eq!(stopped.state, "stopped");

    let result = handle.join().expect("request thread should join");
    assert!(result.is_err(), "inflight request should fail once the sidecar process is terminated");
}
