---
Status: accepted
---

# 采用 oh-my-pi SDK Sidecar 作为 Agent 集成边界

建模 Agent 与 Tauri 工作台之间采用本地 Agent Sidecar：Tauri 负责启动和监控子进程，Sidecar 直接使用 pi / oh-my-pi SDK 管理 Agent 会话、模型选择、工具调用和事件订阅，并向前端暴露项目自定义的结构化事件接口。虽然 SDK、ACP 和 CLI 方案都可能体现为“启动子进程”，但真正差异在协议所有权：SDK Sidecar 让项目直接定义 MBSE 模型工件事件，ACP 更适合作为后续互操作适配层，CLI stdout 解析不作为稳定集成边界。
