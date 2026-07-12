# MBSE 工作区 SysML v2 建模规范

本文件是 MBSE 建模工作台的本地编写规范。最终模型必须保存到 `output/model.sysml`，最终 JSON 视图模型必须保存到 `output/view-model.json`。不要把最终工件塞进 `yield` 参数。

## 事实来源

- `input/confirmed-data.json` 是唯一业务事实来源。
- `input/source-material.md` 仅用于追溯原始语境，不得覆盖或补造 `confirmed-data.json` 中没有的事实。
- `references/example-model.sysml` 和 `references/example-view-model.json` 只演示结构，禁止复制其中的项目标识、需求或分系统作为当前项目事实。

## 输出路径

```text
output/model.sysml
output/view-model.json
```

只维护这两个最终工件。需要临时文件时放到 `scratch/`，完成前自行删除。

## SysML v2 文件约束

1. 顶层必须恰好声明当前 `confirmed-data.json.packageName` 对应的 package：

```sysml
package ExamplePackage {
  // declarations and usages
}
```

2. 每个已确认需求 ID 必须在文本中出现，并有独立需求声明或需求用法。推荐：

```sysml
requirement def <'REQ-001'> {
  doc /* Requirement text. */
}
```

3. 每个已确认分系统都必须由 part definition 或 part usage 表达。推荐：

```sysml
part def Spacecraft;
part def Payload;

part spacecraft : Spacecraft {
  part payload : Payload;
}
```

4. 每个已确认活动都必须由 action definition 或 action usage 表达，并通过注释、metadata 或 satisfy/trace 关系保留需求关联和执行分系统。

```sysml
action def CruiseSafety;
action cruiseSafety : CruiseSafety;
```

5. 每个接口必须保留源分系统、目标分系统、源端口、目标端口和接口类型。推荐使用 port definition、interface definition 和 connection usage：

```sysml
port def TelemetryPort;
interface def TelemetryInterface;
connection telemetryConnection connect source.telemetryOut to target.telemetryIn;
```

6. 参数约束必须保留约束表达式、参数单位以及 constraint—parameter binding。表达式必须来自已确认数据，不能自行发明阈值。

7. 使用合法、稳定且可交叉引用的标识符。含连字符或非标识符字符的外部 ID 应放在引号名称或注释中，不要直接作为未转义标识符。

8. 禁止：
   - 默认模板数据、占位节点、`TODO`、`<placeholder>`；
   - 缺失引用、悬空连接、与 JSON 不一致的 package/projectId；
   - 把示例项目的事实复制成当前项目事实；
   - 在校验通过前调用 `yield`。

## 推荐工作循环

1. 阅读 `input/confirmed-data.json`、本规范、视图模型契约和两个示例。
2. 创建或更新两个固定输出文件。
3. 调用 `verify`。
4. 按 `verify` 的路径化错误逐项修正，重复 2–3。
5. `verify` 通过后调用 `yield`，只提交执行记录报告。

## 外部规范入口

若网络工具可用，可查阅 OMG SysML v2 官方规范入口：https://www.omg.org/sysml/sysmlv2/

外部规范用于理解语法；当前项目事实仍只能来自 `input/confirmed-data.json`。