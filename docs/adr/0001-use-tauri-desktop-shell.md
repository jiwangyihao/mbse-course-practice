---
Status: accepted
---

# 采用 Tauri 作为桌面外壳

课程大实践项目采用 Tauri 作为桌面应用外壳：前端使用 Web 技术实现 SysML / MBSE 可视化交互，后端通过 Tauri Rust Core 管理本地文件、进程、凭据与 Agent 通信。这个选择锁定了桌面交付形态，但换来更贴近本机建模工具的体验、比 Electron 更小的运行时占用，以及 Tauri 官方架构中 Rust Core + OS WebView + IPC 的权限隔离模型；后续不再优先考虑纯 Web 或 Electron，除非课程验收明确要求浏览器部署。

参考：Tauri 官方架构说明 https://v2.tauri.app/concept/architecture/ ；Tauri 进程模型说明 https://v2.tauri.app/concept/process-model/ 。
