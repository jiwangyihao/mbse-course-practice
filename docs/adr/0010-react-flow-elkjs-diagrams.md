---
Status: accepted
---

# 采用 React Flow 与 elkjs 渲染 SysML 视图

Tauri 前端采用 React Flow + elkjs 渲染 SysML 相关视图：React Flow 承担节点、边、端口、视口和交互，elkjs 承担自动布局。相较 Sprotty + ELK，这个选择牺牲一部分模型驱动框架完整性，换取 React 生态和课程项目交付速度；相较 Cytoscape.js，它更适合节点式应用界面与有限图交互；相较自研 SVG，它避免把主要时间耗在图形基础设施上。

参考：React Flow 布局文档 https://reactflow.dev/learn/layouting/layouting ；elkjs README https://github.com/kieler/elkjs 。
