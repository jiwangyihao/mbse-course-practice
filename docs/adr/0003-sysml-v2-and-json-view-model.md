---
Status: accepted
---

# 采用 SysML v2 文本与 JSON 视图模型作为权威数据源

MBSE 建模工作台以 SysML v2 文本作为可提交、可解释、贴近标准的权威模型表达，同时维护一个规范化 JSON 视图模型供 Tauri 前端渲染结构图、需求图、行为图和追溯矩阵。这个选择避免直接逆向 Sysbuilder 工程格式的高风险，也避免纯自有 JSON 导致 SysML 说服力不足；代价是需要实现 SysML v2 与 JSON 视图模型之间的转换与一致性检查。

参考：OMG SysML v2 / Systems Modeling API 资料、Open-MBEE SysML v2 Visualization Service、Eclipse SysON 的 SysML v2 Web 建模方向。
