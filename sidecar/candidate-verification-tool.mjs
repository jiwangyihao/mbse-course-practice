import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const VERIFY_CANDIDATE_PARAMETERS = z.strictObject({});

function isMissingFile(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT';
}

async function inspectCandidateFile(candidatePath, validateConfirmedData) {
  let source;
  try {
    source = await readFile(candidatePath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        valid: false,
        status: 'candidate-file-missing',
        candidatePath,
        error: `候选文件不存在：${candidatePath}`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      status: 'candidate-file-unreadable',
      candidatePath,
      error: `无法读取候选文件 ${candidatePath}：${message}`,
    };
  }

  let confirmedData;
  try {
    confirmedData = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      status: 'candidate-file-invalid-json',
      candidatePath,
      error: `候选文件不是有效 JSON：${message}`,
    };
  }

  try {
    validateConfirmedData(confirmedData);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      status: 'candidate-data-invalid',
      candidatePath,
      error: message,
    };
  }

  return {
    valid: true,
    status: 'passed',
    candidatePath,
    confirmedData,
    digest: createHash('sha256').update(source).digest('hex'),
  };
}

function formatCandidateVerification(result) {
  const invocation = '工具调用成功；verify_candidate 参数 {} 已被正确接受。';
  if (result.valid) {
    return [
      'VERIFY_CANDIDATE_RESULT: PASSED',
      invocation,
      `已校验候选文件（绝对路径）：${result.candidatePath}`,
      'confirmedData 结构、稳定 ID 与引用关系通过确定性校验。文件未再修改时可以调用 yield。',
    ].join('\n');
  }

  if (result.status === 'candidate-file-missing') {
    return [
      'VERIFY_CANDIDATE_RESULT: CANDIDATE_FILE_MISSING',
      invocation,
      `候选文件不存在（绝对路径）：${result.candidatePath}`,
      `下一步：调用 write 工具；path 必须精确设置为 "${result.candidatePath}"，content 必须是完整 confirmedData JSON 对象。创建后再次以空对象 {} 调用 verify_candidate。`,
    ].join('\n');
  }

  const resultCode = result.status === 'candidate-file-invalid-json'
    ? 'INVALID_JSON'
    : result.status === 'candidate-file-unreadable'
      ? 'CANDIDATE_FILE_UNREADABLE'
      : 'INVALID_CANDIDATE_DATA';
  return [
    `VERIFY_CANDIDATE_RESULT: ${resultCode}`,
    invocation,
    `候选文件（绝对路径）：${result.candidatePath}`,
    `原因：${result.error}`,
    `下一步：调用 edit 修改上述文件；需要整体重写时调用 write。修改后再次以空对象 {} 调用 verify_candidate。`,
  ].join('\n');
}

function formatUnverifiedCandidate(candidatePath, status) {
  const reason = status === 'candidate-changed-after-verify'
    ? '候选文件在最近一次通过校验后又被修改。'
    : '候选文件尚未通过本会话的 verify_candidate 校验。';
  return [
    `VERIFY_CANDIDATE_RESULT: ${status === 'candidate-changed-after-verify' ? 'CANDIDATE_CHANGED_AFTER_VERIFY' : 'CANDIDATE_NOT_VERIFIED'}`,
    'yield 已被阻止；不能用聊天内容或 yield 参数绕过落盘校验。',
    `候选文件（绝对路径）：${candidatePath}`,
    `原因：${reason}`,
    '下一步：以空对象 {} 调用 verify_candidate；通过后且不再修改文件时再调用 yield。',
  ].join('\n');
}

export function createCandidateVerificationGate({ candidatePath, validateConfirmedData }) {
  let verifiedDigest;

  const verifyAndRemember = async () => {
    const result = await inspectCandidateFile(candidatePath, validateConfirmedData);
    verifiedDigest = result.valid ? result.digest : undefined;
    return result;
  };

  const requireVerifiedCandidate = async () => {
    const result = await inspectCandidateFile(candidatePath, validateConfirmedData);
    if (!result.valid) {
      throw new Error(formatCandidateVerification(result));
    }
    if (!verifiedDigest) {
      throw new Error(formatUnverifiedCandidate(candidatePath, 'candidate-not-verified'));
    }
    if (verifiedDigest !== result.digest) {
      throw new Error(formatUnverifiedCandidate(candidatePath, 'candidate-changed-after-verify'));
    }
    return result.confirmedData;
  };

  const tool = {
    name: 'verify_candidate',
    label: 'Verify persisted candidate MBSE data',
    description: [
      `参数始终是严格空对象 {}。只读取固定候选文件 ${candidatePath}，不接受 confirmedData 对象参数。`,
      '文件可以不完整；工具会返回绝对路径和下一步 write/edit 指令。不要用 Python/eval 自行编写引用校验器。',
      '通过后不要再修改文件；进入 SysML 工作区建模阶段后改用 verify。',
    ].join(''),
    parameters: VERIFY_CANDIDATE_PARAMETERS,
    approval: 'read',
    execute: async () => {
      const result = await verifyAndRemember();
      return {
        content: [{ type: 'text', text: formatCandidateVerification(result) }],
        details: {
          valid: result.valid,
          status: result.status,
          invocationAccepted: true,
          invocationParameters: {},
          candidatePath,
          nextAction: result.valid ? 'yield-without-changing-candidate-file' : 'write-or-edit-candidate-file',
          ...(result.valid ? {} : { error: result.error }),
        },
      };
    },
  };

  const createYieldGuardExtension = (pi) => {
    pi.on('tool_call', async (event) => {
      if (event.toolName !== 'yield') return undefined;
      try {
        await requireVerifiedCandidate();
        return undefined;
      } catch (error) {
        return {
          block: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
  };

  return {
    tool,
    createYieldGuardExtension,
    requireVerifiedCandidate,
  };
}
