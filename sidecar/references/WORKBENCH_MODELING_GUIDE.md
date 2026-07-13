# MBSE 工作区 SysML v2 建模规范

本文件是 MBSE 建模工作台的本地编写规范。最终模型必须保存到固定多文件 SysML source set：`output/model.sysml`、`output/requirements.sysml`、`output/structure.sysml`、`output/behavior.sysml`、`output/constraints.sysml`。不要创建 `output/view-model.json`，也不要把最终工件塞进 `yield` 参数。

## 事实来源

- `input/confirmed-data.json` 是唯一业务事实来源。
- `input/source-material.md` 仅用于追溯原始语境，不得覆盖或补造 `confirmed-data.json` 中没有的事实。
- `references/example-source-set/` 与 `references/example-derived-view-model.json` 只演示结构；最终输出只能写固定 SysML source set，JSON 视图模型由 `verify` / `yield` 从 strict 语义自动派生。

## 输出路径

```text
output/model.sysml
output/requirements.sysml
output/structure.sysml
output/behavior.sysml
output/constraints.sysml
```

最终 SysML 只维护这组固定源文件。需要复用或保留的临时工件统一放到 `scratch/`，不要混入 `output/`。

## 辅助脚本与临时工件

- `eval` 只用于短小、增量、交互式的表达式或状态检查，不要在单次 `eval` 中内联长篇多行 Python。
- 包含多个步骤、函数、复杂循环、多文件解析、批量转换或预计持续运行的 Python 等辅助脚本，应先用 `write` / `edit` 写入 `scratch/scripts/`，例如 `scratch/scripts/check_model.py`，再用短命令执行脚本文件。
- 不要用自写 Python、JavaScript、正则或其他脚本复刻或替代 `verify` 的 SysML 语法、语义和派生视图校验。
- 中间数据写入 `scratch/data/`，运行日志写入 `scratch/logs/`，分析笔记写入 `scratch/notes/`；可在 `scratch/` 下继续创建必要子目录，并在任务期间保留仍有诊断或复用价值的文件。

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

1. 阅读 `input/confirmed-data.json`、本规范、视图模型契约和 source set 示例。
2. 尽早把当前最好的一版 SysML 写入 `output/` 的固定源文件；当前版本可以不完整、缺文件或存在语法问题，不必先自行证明它满足全部条件。
3. 直接调用 `verify` 获取权威的路径化诊断。`verify` 不是验收前置门槛，而是早期、反复使用的反馈工具。
4. 按 `verify` 的错误逐项修正并持续落盘，重复 2–3；不要先写长 Python 脚本模拟校验。
5. `verify` 通过后调用 `yield`，只提交执行记录报告。

## 外部规范入口

若网络工具可用，可查阅 OMG SysML v2 官方规范入口：https://www.omg.org/sysml/sysmlv2/

外部规范用于理解语法；当前项目事实仍只能来自 `input/confirmed-data.json`。