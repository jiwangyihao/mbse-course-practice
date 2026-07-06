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
npm run dev
npm run tauri:dev
```

如果本机暂未安装 Rust / Cargo，前端与契约测试仍可运行；Tauri 桌面壳需要先安装 Rust 工具链后再执行 `npm run tauri:dev`。

## 验证

```bash
npm run typecheck
npm run test:contract
npm run build
```
