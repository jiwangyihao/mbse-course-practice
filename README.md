# MBSE 建模工作台

这是《基于模型的系统工程》课程大实践的独立 Tauri 桌面项目，工作区为 `C:\tmp\mbse-course-practice`。它面向天问二号探测器案例，目标是形成“材料导入 + 向导确认 → 建模 Agent 生成 SysML v2 → JSON 视图模型 → 多视图展示 → 静态校验 → 完整课程交付包”的端到端闭环。

本项目不是前 12 个小实验工作区的一部分，也不复用 `C:\tmp\mbse-course-lab` 中的小实验材料。

## 本切片范围

Issue #2 建立最小可运行骨架：

- Tauri + React + TypeScript 工作台入口。
- 内置天问二号样例项目契约。
- 源材料、项目元数据、最小 SysML v2 与 JSON 视图模型工件占位。
- 端到端项目契约测试。

## 本地运行

```bash
npm install
npm run tauri:dev
```

`npm run tauri:dev` 会启动 Tauri 桌面壳，并由 Tauri 拉起 Vite 前端开发服务器；不要只用浏览器打开 Vite 页面替代桌面应用验收。

如果 Windows 将 `C:\tmp` 识别为不受信任挂载点，Rust 依赖编译可能在默认 `src-tauri/target` 目录遇到 `os error 448`。可把 Cargo target 放到用户目录后再启动 Tauri：

```bash
set CARGO_TARGET_DIR=%LOCALAPPDATA%\mbse-course-practice-tauri-target
npm run tauri:dev
```

## 验证

```bash
npm run typecheck
npm run test:contract
npm run build
```
