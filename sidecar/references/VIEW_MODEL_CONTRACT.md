# JSON 视图模型契约

最终文件：`output/view-model.json`。

## 根对象

必须包含：

```json
{
  "schemaVersion": "0.4.0",
  "projectId": "<confirmed-data.projectId>",
  "generatedFrom": "<confirmed-data.packageName>",
  "source": "sdk-agent-generated",
  "views": [],
  "validation": {
    "status": "passed",
    "checkedRules": ["schema"]
  }
}
```

`views` 必须恰好覆盖以下六种 `kind`，每种至少一个对象：

- `requirements`
- `bdd`
- `activity`
- `traceability-matrix`
- `ibd`
- `parameter-constraints`

## 通用视图字段

每个视图至少包含：

- `id`、`title`、`kind`
- `layout: "auto"`
- `layoutEngine`: `deterministic-layered-layout`、`matrix-layout` 或 `elk-layered`
- `nodes`: 数组
- `edges`: 数组

每个 node 至少包含：

```json
{
  "id": "stable-node-id",
  "kind": "requirement",
  "label": "显示名称",
  "position": { "x": 0, "y": 0 }
}
```

每个 edge 至少包含 `id`、`kind`、`source`、`target`。`source` 和 `target` 必须引用当前视图中存在的 node ID。

## 需求追溯矩阵

`traceability-matrix` 视图额外必须包含 `rows`、`columns`、`cells`：

```json
{
  "rows": [
    { "id": "row-REQ-001", "requirementId": "REQ-001", "label": "需求标题" }
  ],
  "columns": [
    { "id": "column-system", "elementId": "system", "kind": "structure", "label": "系统" }
  ],
  "cells": [
    {
      "rowId": "row-REQ-001",
      "requirementId": "REQ-001",
      "columnId": "column-system",
      "covered": true,
      "evidence": "可选说明"
    }
  ]
}
```

每个需求行必须至少有一个 `covered: true` 的单元格；否则静态校验产生未覆盖需求 finding，整体不通过。

## IBD 内部块图

`ibd` 视图额外必须包含 `ports` 和 `connections`。

Port 必填字段：`id`、`label`、`kind`、`ownerId`、`interfaceId`。`ownerId` 必须引用 IBD node。

Connection 必填字段：`id`、`kind`、`source`、`target`、`sourcePort`、`targetPort`、`label`。

每条 connection 必须与一条 `edges` 中的 `kind: "connection"` 记录一一对应，并且以下字段完全一致：

- `id`
- `source`
- `target`
- `sourcePort`
- `targetPort`

端口必须属于各自连接端点；源端口和目标端口必须存在。

## 参数约束视图

`parameter-constraints` 视图额外必须包含 `constraints`、`parameters`、`bindings`。

Constraint：`id`、`label`、`expression`、`relatedElementIds`、`requirementIds`。

Parameter：`id`、`label`、`unit`、`unitSymbol`、`relatedElementIds`。

Binding：`id`、`kind: "binding"`、`constraintId`、`parameterId`、`label`、`relatedElementIds`。

Binding 的 `constraintId` 和 `parameterId` 必须分别引用存在的 constraint 和 parameter。

## 完整性约束

- 每个 `confirmed-data.json.requirements[].id` 必须出现在视图模型节点或 `elementId` 中。
- 每个 `confirmed-data.json.subsystems[].id` 必须出现在结构或 IBD 节点中。
- `projectId`、`generatedFrom`、`source` 必须与工作区输入契约一致。
- 不允许占位字符串、缺失引用或与 SysML 文件冲突的项目标识。
- `verify` 返回的 error 和 finding 都必须修复后才能 `yield`。