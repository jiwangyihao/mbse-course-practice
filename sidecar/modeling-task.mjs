import path from 'node:path';

import { modelingWorkspacePaths } from './modeling-workspace.mjs';

export const WORKSPACE_EXECUTION_GUIDANCE = [
  '尽早把当前最好的一版 SysML 写入 output/ 下的固定源文件；这可以是不完整、尚未通过校验的草案。不要在 SysML 落盘前先编写脚本试图证明它正确。',
  'verify 是发现当前缺口并驱动下一轮修改的权威反馈工具，不是必须先满足全部条件才能使用的前置门槛。即使当前 SysML 不完整、缺文件或存在语法问题，也应尽早直接调用 verify，并按路径化诊断逐步修正。',
  '当 verify 返回 VERIFY_RESULT: INVALID_SYSML 时，说明工具调用和空对象参数 {} 都正确，失败的是 SysML 候选文件校验。不要修改参数或原样重复调用；先按“文件、位置、原因、修改指令”编辑指定 output/*.sysml，再用相同的 {} 参数调用 verify。',
  '不要用自写 Python、JavaScript、正则或其他脚本复刻、猜测或替代 verify 的 SysML 语法、语义和视图模型校验；辅助脚本不能成为调用 verify 的前置条件。',
  'eval 只用于短小、增量、交互式的表达式或状态检查。不要在单次 eval 工具调用中编写长篇多行 Python，尤其不要内联包含多个函数、复杂循环、多文件解析或批量转换的脚本。',
  '凡是需要复用、包含多步骤或预计会持续运行的 Python 等辅助脚本，积极使用 write/edit 落盘到工作区 scratch/scripts/，例如 scratch/scripts/check_model.py，再用短命令执行该文件。',
  '需要保留的中间数据、日志、分析笔记和其他临时工件分别落盘到 scratch/data/、scratch/logs/、scratch/notes/；可在 scratch/ 下继续创建必要子目录。临时工件不得写入 output/，output/ 只保存最终 SysML source set。',
].join('\n');


export function buildWorkspaceModelingPrompt(confirmedData, workspaceRoot) {
  const absoluteOutputFiles = modelingWorkspacePaths.files
    .map((file) => path.resolve(workspaceRoot, ...file.split('/')));
  const forbiddenViewModel = path.resolve(workspaceRoot, ...modelingWorkspacePaths.forbiddenViewModel.split('/'));
  return [
    `在临时工作区 ${workspaceRoot} 内完成最终 MBSE 工件。`,
    '先阅读 WORKSPACE.md、input/confirmed-data.json、references/ 下的规范、ADR 和示例。',
    'input/confirmed-data.json 是唯一业务事实来源；示例只用于理解语法和数据结构。',
    `必须创建并维护以下 SysML 源文件（绝对路径）：${absoluteOutputFiles.join('、')}。`,
    `必须调用 write 工具，把第一版 SysML 分别写入上述绝对路径；后续调用 edit 修改。不能只在回复、思考、工具参数或 yield 中给出 SysML。`,
    `禁止创建 ${forbiddenViewModel}；JSON 视图模型由 verify/yield 从 strict sysml2 语义自动派生。`,
    '你可以使用本会话开放的 OMP 内置工具自主探索、编写和修正文件，但所有工件必须限制在上述临时工作区。',
    WORKSPACE_EXECUTION_GUIDANCE,
    '根据每次 verify 返回的绝对路径诊断迭代修正，直到 VERIFY_RESULT: PASSED。',
    '只有确信工作完全完成且 verify 已通过后才能调用 yield。',
    `当前 projectId=${confirmedData.projectId}，packageName=${confirmedData.packageName}。`,
  ].join('\n');
}
