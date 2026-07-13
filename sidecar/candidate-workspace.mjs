import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CANDIDATE_RELATIVE_PATH = path.join('output', 'confirmed-data.json');
const CANDIDATE_SCHEMA_RELATIVE_PATH = path.join('references', 'confirmed-data.schema.json');

function workspaceReadme(candidatePath) {
  return `# 候选抽取临时工作区

## 固定输入

- 原始材料：input/source-material.md
- confirmedData JSON Schema：references/confirmed-data.schema.json

## 唯一候选工件

- 必须落盘的绝对路径：${candidatePath}
- 首次创建必须调用 write，并把 path 精确设置为上述绝对路径。
- 后续修改调用 edit；需要整体重写时也可再次调用 write。
- 网页检索、阅读结果、聊天中的 JSON 和 yield 参数都不是候选工件。只有上述文件是候选工件。
- verify_candidate 的参数始终是空对象 {}。该工具只读取上述固定文件；文件不存在时校验不会生效。

## 临时工件

- 长篇或可复用脚本：scratch/scripts/
- 中间数据：scratch/data/
- 运行日志：scratch/logs/
- 分析笔记：scratch/notes/

候选引用校验请调用 verify_candidate。eval 只用于短小检查；不要用长 Python 脚本复刻候选校验。
`;
}

export async function createCandidateWorkspace(sourceText, confirmedDataSchema) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mbse-agent-candidate-'));
  const candidatePath = path.join(root, CANDIDATE_RELATIVE_PATH);
  const directories = [
    'input',
    'references',
    'output',
    'scratch/scripts',
    'scratch/data',
    'scratch/logs',
    'scratch/notes',
  ];
  await Promise.all(directories.map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  await Promise.all([
    writeFile(path.join(root, 'input', 'source-material.md'), sourceText, 'utf8'),
    writeFile(
      path.join(root, CANDIDATE_SCHEMA_RELATIVE_PATH),
      `${JSON.stringify(confirmedDataSchema, null, 2)}\n`,
      'utf8',
    ),
    writeFile(path.join(root, 'WORKSPACE.md'), workspaceReadme(candidatePath), 'utf8'),
  ]);

  return {
    root,
    candidatePath,
    candidateRelativePath: CANDIDATE_RELATIVE_PATH,
    dispose: async () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  };
}

export const candidateWorkspacePaths = {
  candidate: CANDIDATE_RELATIVE_PATH,
  schema: CANDIDATE_SCHEMA_RELATIVE_PATH,
};
