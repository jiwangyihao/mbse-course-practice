fn main() {
    if std::env::args().any(|arg| arg == "--agent-sidecar") {
        mbse_course_practice_lib::agent_sidecar::run_agent_sidecar_process();
        return;
    }

    mbse_course_practice_lib::run();
}
