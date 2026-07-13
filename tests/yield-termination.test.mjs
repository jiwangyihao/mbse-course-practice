import { describe, expect, it, vi } from 'vitest';
import { promptUntilSuccessfulYield } from '../sidecar/yield-termination.mjs';

describe('候选阶段成功 yield 终止语义', () => {
  it('yield 成功后立即 abort，并且不等待模型自行进入 idle', async () => {
    let listener;
    let releasePrompt;
    const promptBlockedUntilAbort = new Promise((resolve) => {
      releasePrompt = resolve;
    });
    const session = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        listener({
          type: 'tool_execution_end',
          toolName: 'yield',
          toolCallId: 'candidate-yield',
          isError: false,
          result: { details: { status: 'success', data: { suggestions: [] } } },
        });
        await promptBlockedUntilAbort;
      }),
      abort: vi.fn(async () => {
        releasePrompt();
      }),
      waitForIdle: vi.fn(async () => undefined),
    };

    await expect(promptUntilSuccessfulYield({
      session,
      promptText: '生成候选并 yield',
      onEvent: vi.fn(),
    })).resolves.toEqual({ terminatedByYield: true });

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.abort).toHaveBeenCalledWith({ goalReason: 'internal' });
    expect(session.waitForIdle).not.toHaveBeenCalled();
  });

  it('增量 yield section 不终止会话，继续等待终止 yield', async () => {
    let listener;
    const session = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        listener({
          type: 'tool_execution_end',
          toolName: 'yield',
          toolCallId: 'candidate-suggestions-section',
          isError: false,
          result: {
            details: {
              status: 'success',
              type: ['suggestions'],
              data: [],
            },
          },
        });
      }),
      abort: vi.fn(async () => undefined),
      waitForIdle: vi.fn(async () => undefined),
    };

    await expect(promptUntilSuccessfulYield({
      session,
      promptText: '先提交增量 suggestions',
      onEvent: vi.fn(),
    })).resolves.toEqual({ terminatedByYield: false });

    expect(session.abort).not.toHaveBeenCalled();
    expect(session.waitForIdle).toHaveBeenCalledTimes(1);
  });
});
