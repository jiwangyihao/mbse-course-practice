# 天问二号任务与需求材料

天问二号探测器样例项目用于 MBSE 建模工作台的内置建模输入。该材料覆盖材料导入、确认向导、模型生成、多视图浏览与静态校验，不依赖其他练习目录。

## 项目标识

- projectId: `tianwen-2`
- packageName: `Tianwen2ConfirmedModel`

## 使命目标

- 对近地小行星开展采样返回任务，形成可追溯的任务需求、系统结构和关键活动模型。
- 在主带彗星扩展探测阶段验证深空自主运行、能源管理和测控通信能力。
- 为 SysML v2 文本、JSON 视图模型和校验结果提供可解释的来源。

## 候选需求

- REQ-TW2-001
  - title: 小行星采样返回任务
  - text: 探测器应支持近地小行星采样返回任务。
  - parentId: null
  - tracedTo: 航天器平台, 采样返回分系统
- REQ-TW2-002
  - title: 深空巡航安全边界
  - text: 探测器应在深空巡航阶段维持姿态、能源和热控安全边界。
  - parentId: REQ-TW2-001
  - tracedTo: 电源与热控分系统, 制导导航与控制分系统
- REQ-TW2-003
  - title: 测控通信与数据下传
  - text: 探测器应通过测控通信链路下传工程遥测与科学数据。
  - parentId: REQ-TW2-001
  - tracedTo: 测控通信分系统
- REQ-TW2-004
  - title: 模型工件追溯关系
  - text: 探测器应保留模型工件与需求、结构、行为视图之间的追溯关系。
  - parentId: REQ-TW2-001
  - tracedTo: 航天器平台, 测控通信分系统

## 候选分系统

- subsystem
  - id: spacecraft-platform
  - name: 航天器平台
  - parentId: null
- subsystem
  - id: sampling-return
  - name: 采样返回分系统
  - parentId: spacecraft-platform
- subsystem
  - id: ttc-communication
  - name: 测控通信分系统
  - parentId: spacecraft-platform
- subsystem
  - id: power-thermal
  - name: 电源与热控分系统
  - parentId: spacecraft-platform
- subsystem
  - id: gnc
  - name: 制导导航与控制分系统
  - parentId: spacecraft-platform

## 候选活动

- activity
  - id: activity-sample-return
  - title: 近地小行星取样返回
  - text: 接近目标小行星，执行近距离探测、采样封装与返回准备。
  - requirementIds: REQ-TW2-001
  - performedBy: sampling-return, gnc
- activity
  - id: activity-cruise-safety
  - title: 深空巡航安全维持
  - text: 在深空巡航阶段维持姿态、能源和热控安全边界。
  - requirementIds: REQ-TW2-002
  - performedBy: spacecraft-platform, power-thermal, gnc
- activity
  - id: activity-telemetry-downlink
  - title: 遥测与科学数据下传
  - text: 通过测控通信链路完成深空测控、数据下传和遥测接收。
  - requirementIds: REQ-TW2-003
  - performedBy: ttc-communication
- activity
  - id: activity-trace-coverage-check
  - title: 模型工件追溯覆盖校验
  - text: 检查需求到结构和行为视图的覆盖关系，并把缺口暴露为可操作校验结果。
  - requirementIds: REQ-TW2-004
  - performedBy: spacecraft-platform, ttc-communication

## 候选接口

- interface
  - id: connection-sample-transfer-to-platform
  - label: 样品转移接口
  - kind: sample
  - interfaceId: sample-transfer
  - sourceSubsystemId: sampling-return
  - sourcePortId: sample-transfer-out
  - sourcePortLabel: 样品转移与封装接口
  - targetSubsystemId: spacecraft-platform
  - targetPortId: sample-return-mechanical-interface
  - targetPortLabel: 样品转移接口
  - requirementIds: REQ-TW2-001
- interface
  - id: connection-sample-telemetry-to-ttc
  - label: 采样遥测数据接口
  - kind: data
  - interfaceId: telemetry-data
  - sourceSubsystemId: sampling-return
  - sourcePortId: sample-telemetry-out
  - sourcePortLabel: 采样遥测数据接口
  - targetSubsystemId: ttc-communication
  - targetPortId: data-bus-in
  - targetPortLabel: 遥测数据接收接口
  - requirementIds: REQ-TW2-003
- interface
  - id: connection-power-thermal-to-sampling
  - label: 供电与热控接口
  - kind: power
  - interfaceId: power-thermal
  - sourceSubsystemId: power-thermal
  - sourcePortId: power-thermal-service
  - sourcePortLabel: 供电与热控服务接口
  - targetSubsystemId: sampling-return
  - targetPortId: sample-power-thermal-in
  - targetPortLabel: 采样供电与热控接口
  - requirementIds: REQ-TW2-002
- interface
  - id: connection-gnc-data-to-ttc
  - label: 姿态遥测数据接口
  - kind: control
  - interfaceId: telemetry-data
  - sourceSubsystemId: gnc
  - sourcePortId: attitude-control-data
  - sourcePortLabel: 姿态控制数据接口
  - targetSubsystemId: ttc-communication
  - targetPortId: telemetry-downlink
  - targetPortLabel: 测控通信下传接口
  - requirementIds: REQ-TW2-002, REQ-TW2-003

## 候选约束

- constraint
  - id: constraint-mass-budget
  - label: 质量预算约束
  - expression: spacecraft-dry-mass <= 1000 kg
  - relatedElementIds: spacecraft-platform, sampling-return
  - requirementIds: REQ-TW2-001
- constraint
  - id: constraint-power-budget
  - label: 电源输出约束
  - expression: solar-array-output >= 2000 W
  - relatedElementIds: power-thermal, spacecraft-platform
  - requirementIds: REQ-TW2-002

## 候选参数

- parameter
  - id: spacecraft-dry-mass
  - label: 探测器干质量
  - unit: kg
  - unitSymbol: kg
  - relatedElementIds: spacecraft-platform, sampling-return
- parameter
  - id: solar-array-output
  - label: 太阳翼输出功率
  - unit: W
  - unitSymbol: W
  - relatedElementIds: power-thermal, spacecraft-platform

## 候选绑定

- binding
  - id: binding-mass-budget-dry-mass
  - kind: binding
  - constraintId: constraint-mass-budget
  - parameterId: spacecraft-dry-mass
  - label: 质量参数绑定
  - relatedElementIds: spacecraft-platform, sampling-return
- binding
  - id: binding-power-budget-solar-array-output
  - kind: binding
  - constraintId: constraint-power-budget
  - parameterId: solar-array-output
  - label: 功率参数绑定
  - relatedElementIds: power-thermal, spacecraft-platform
