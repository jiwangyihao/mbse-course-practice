import { AGENT_TRACE_PROTOCOL_VERSION } from './agent-trace-shared.mjs';

const MAX_SUMMARY_LENGTH = 240;

export function createTraceCollector({ sessionId, provider, model, emitFrame }) {
  let sequence = 0;
  const events = [];

  const emit = ({
    type,
    phase = 'unknown',
    rawKind,
    message,
    payload,
    ...extra
  }) => {
    const event = {
      protocolVersion: AGENT_TRACE_PROTOCOL_VERSION,
      sessionId,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      phase,
      type,
      rawKind,
      message,
      payload: toJsonSafe(payload),
      ...extra,
    };
    events.push(event);
    emitFrame?.(event);
    return event;
  };

  return {
    sessionId,
    provider,
    model,
    events,
    emit,
    emitSessionStarted(extra = {}) {
      return emit({
        type: 'session-started',
        phase: 'session',
        rawKind: 'session_start',
        message: `SDK Agent 会话已启动：${provider ?? 'unknown-provider'}/${model ?? 'unknown-model'}`,
        payload: { provider, model, ...extra },
        provider,
        model,
      });
    },
    emitProgress(message, percent, phase = 'unknown', payload = {}) {
      return emit({
        type: 'progress',
        phase,
        rawKind: 'progress',
        message,
        payload: { percent, ...payload },
        percent,
      });
    },
    emitPhase(phase, phaseStatus, step, payload = {}) {
      return emit({
        type: 'phase',
        phase,
        rawKind: `phase_${phaseStatus}`,
        message: `${step}${phaseStatus === 'completed' ? '完成' : '开始'}。`,
        payload: { step, phaseStatus, ...payload },
        phaseStatus,
        step,
      });
    },
    emitError(message, { phase = 'unknown', rawKind = 'error', recoverable = false, code, payload = {} } = {}) {
      return emit({
        type: 'error',
        phase,
        rawKind,
        message,
        payload,
        recoverable,
        code,
      });
    },
    emitSessionFinished(status, completedAt, payload = {}) {
      return emit({
        type: 'session-finished',
        phase: 'session',
        rawKind: 'session_finished',
        message: `SDK Agent 会话${status === 'success' ? '完成' : status === 'cancelled' ? '取消' : '失败'}。`,
        payload: { status, completedAt, ...payload },
        status,
        provider,
        model,
        completedAt,
      });
    },
  };
}

export function forwardSdkSessionEvent(trace, event, defaultPhase) {
  try {
    return forwardSdkSessionEventValue(trace, event, defaultPhase);
  } catch (error) {
    trace.emit({
      type: 'sdk-event',
      phase: typeof defaultPhase === 'string' ? defaultPhase : 'unknown',
      rawKind: 'sdk_event_inspection_error',
      message: '无法安全读取 SDK 事件，已保留可审计错误。',
      payload: {
        event,
        inspection: {
          type: 'inspection-error',
          message: safeErrorMessage(error),
          path: '$.event.type',
        },
      },
    });
    return { kind: 'inspection-error' };
  }
}

function forwardSdkSessionEventValue(trace, event, defaultPhase) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    return;
  }

  switch (event.type) {
    case 'tool_execution_start': {
      trace.emit({
        type: 'tool-call-start',
        phase: inferEventPhase(defaultPhase, event.toolName),
        rawKind: event.type,
        message: `开始执行工具 ${event.toolName}。`,
        payload: event,
        toolCallId: String(event.toolCallId ?? ''),
        toolName: String(event.toolName ?? 'unknown-tool'),
        argsSummary: summarizeValue(event.args),
      });
      return;
    }
    case 'tool_execution_update': {
      trace.emit({
        type: 'tool-call-update',
        phase: inferEventPhase(defaultPhase, event.toolName),
        rawKind: event.type,
        message: `工具 ${event.toolName} 正在返回增量结果。`,
        payload: event,
        toolCallId: String(event.toolCallId ?? ''),
        toolName: String(event.toolName ?? 'unknown-tool'),
        argsSummary: summarizeValue(event.args),
        partialSummary: summarizeToolResult(event.partialResult),
      });
      return;
    }
    case 'tool_execution_end': {
      const toolName = String(event.toolName ?? 'unknown-tool');
      const isError = event.isError === true;
      const result = event.result;
      const yieldDetails = toolName === 'yield'
        && !isError
        && result
        && typeof result === 'object'
        ? result.details
        : undefined;
      trace.emit({
        type: 'tool-call-end',
        phase: inferEventPhase(defaultPhase, toolName),
        rawKind: event.type,
        message: `工具 ${toolName} ${isError ? '失败' : '完成'}。`,
        payload: event,
        toolCallId: String(event.toolCallId ?? ''),
        toolName,
        argsSummary: summarizeValue(event.args),
        resultSummary: summarizeToolResult(result),
        isError,
      });
      return { kind: 'tool-call-end', toolName, isError, yieldDetails };
    }
    case 'message_update': {
      forwardAssistantMessageEvent(trace, event, defaultPhase);
      return;
    }
    default:
      trace.emit({
        type: 'sdk-event',
        phase: defaultPhase,
        rawKind: event.type,
        message: describeSdkEvent(event),
        payload: event,
      });
  }
}

function forwardAssistantMessageEvent(trace, event, defaultPhase) {
  const assistantEvent = event.assistantMessageEvent;
  if (!assistantEvent || typeof assistantEvent !== 'object' || typeof assistantEvent.type !== 'string') {
    trace.emit({
      type: 'sdk-event',
      phase: defaultPhase,
      rawKind: 'message_update',
      message: 'SDK 返回了未知 assistant message update。',
      payload: event,
    });
    return;
  }

  switch (assistantEvent.type) {
    case 'text_delta':
      trace.emit({
        type: 'output-delta',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: '模型返回文本片段。',
        payload: event,
        channel: 'assistant-text',
        text: typeof assistantEvent.delta === 'string' ? assistantEvent.delta : '',
      });
      return;
    case 'toolcall_delta':
      trace.emit({
        type: 'output-delta',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: '模型正在组织工具调用参数。',
        payload: event,
        channel: 'assistant-toolcall',
        text: typeof assistantEvent.delta === 'string' ? assistantEvent.delta : '',
      });
      return;
    case 'thinking_start':
      trace.emit({
        type: 'reasoning-start',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: '模型进入 reasoning 阶段。',
        payload: event,
        contentIndex: numberOrUndefined(assistantEvent.contentIndex),
      });
      return;
    case 'thinking_delta':
      trace.emit({
        type: 'reasoning-delta',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: '模型正在进行 reasoning。',
        payload: event,
        contentIndex: numberOrUndefined(assistantEvent.contentIndex),
        text: typeof assistantEvent.delta === 'string' ? assistantEvent.delta : '',
      });
      return;
    case 'thinking_end':
      trace.emit({
        type: 'reasoning-end',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: '模型完成 reasoning 阶段。',
        payload: event,
        contentIndex: numberOrUndefined(assistantEvent.contentIndex),
        text: typeof assistantEvent.content === 'string' ? assistantEvent.content : '',
      });
      return;
    case 'toolcall_start':
    case 'toolcall_end':
    case 'text_start':
    case 'text_end':
    case 'done':
      trace.emit({
        type: 'sdk-event',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: describeAssistantEvent(assistantEvent.type),
        payload: event,
      });
      return;
    case 'error':
      trace.emit({
        type: 'error',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: assistantEvent.error?.errorMessage ?? '模型流式响应失败。',
        payload: event,
        recoverable: true,
        code: 'assistant-stream-error',
      });
      return;
    default:
      trace.emit({
        type: 'sdk-event',
        phase: defaultPhase,
        rawKind: assistantEvent.type,
        message: describeAssistantEvent(assistantEvent.type),
        payload: event,
      });
  }
}

function describeSdkEvent(event) {
  if (typeof event.type === 'string') {
    return `SDK 事件：${event.type}`;
  }
  return 'SDK 返回了未知事件。';
}

function describeAssistantEvent(type) {
  switch (type) {
    case 'text_start':
      return '模型开始输出文本。';
    case 'text_end':
      return '模型完成文本输出。';
    case 'toolcall_start':
      return '模型开始组织工具调用。';
    case 'toolcall_end':
      return '模型完成工具调用组织。';
    case 'done':
      return '模型完成当前消息流式输出。';
    default:
      return `模型事件：${type}`;
  }
}

function inferEventPhase(defaultPhase, toolName) {
  if (toolName === 'verify' || toolName === 'yield') {
    return 'validation';
  }
  return defaultPhase;
}

function summarizeValue(value) {
  if (value === undefined) {
    return undefined;
  }
  return summarizeSafeValue(toJsonSafe(value));
}

function summarizeToolResult(value) {
  if (value === undefined) {
    return undefined;
  }
  const safe = toJsonSafe(value);
  const contentText = extractToolContentText(safe);
  return contentText ? truncateSummary(contentText) : summarizeSafeValue(safe);
}

function summarizeSafeValue(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized ? truncateSummary(serialized) : undefined;
}

function truncateSummary(value) {
  return value.length > MAX_SUMMARY_LENGTH
    ? `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : value;
}

function extractToolContentText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.content)) {
    return undefined;
  }
  const text = value.content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      return item && typeof item === 'object' && !Array.isArray(item) && typeof item.text === 'string'
        ? item.text
        : undefined;
    })
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

function numberOrUndefined(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const JSON_SAFE_TAG_KEY = '$mbseAgentTrace';

function taggedJsonValue(type, details = {}) {
  return { [JSON_SAFE_TAG_KEY]: { type, ...details } };
}

function jsonValuePath(parent, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function defineJsonProperty(record, key, value) {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function encodePropertyKey(key) {
  if (typeof key === 'string') {
    return { type: 'string', value: key };
  }
  const globalKey = Symbol.keyFor(key);
  return {
    type: 'symbol',
    value: String(key),
    ...(globalKey === undefined ? {} : { globalKey }),
  };
}

function ownPropertyPath(parent, key, index) {
  return typeof key === 'string'
    ? jsonValuePath(parent, key)
    : `${parent}.<symbol:${index}>`;
}

function errorMessage(error) {
  try {
    if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
      if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
        return descriptor.value;
      }
    }
  } catch {
    // Fall through to string conversion.
  }
  try {
    return String(error);
  } catch {
    return 'Inspection failed with an uninspectable thrown value.';
  }
}

export function safeErrorMessage(error) {
  return errorMessage(error);
}
function toJsonSafe(value, seen = new WeakMap(), path = '$') {
  try {
    return toJsonSafeValue(value, seen, path);
  } catch (error) {
    return taggedJsonValue('inspection-error', {
      message: errorMessage(error),
      path,
      valueType: typeof value,
    });
  }
}


function inspectOwnPropertyDescriptor(value, key) {
  try {
    return { descriptor: Object.getOwnPropertyDescriptor(value, key) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function readPropertyForAudit(value, key, seen, path) {
  try {
    return toJsonSafe(value[key], seen, path);
  } catch (error) {
    return taggedJsonValue('property-inspection-error', { message: errorMessage(error) });
  }
}

function encodeOwnProperties(value, keys, seen, path) {
  return keys.map((key, index) => {
    const inspected = inspectOwnPropertyDescriptor(value, key);
    const descriptor = inspected.descriptor;
    if (inspected.error) {
      return {
        key: encodePropertyKey(key),
        descriptor: { kind: 'uninspectable' },
        error: taggedJsonValue('property-inspection-error', { message: inspected.error }),
      };
    }
    if (!descriptor) {
      return {
        key: encodePropertyKey(key),
        descriptor: { kind: 'missing' },
      };
    }
    const propertyPath = ownPropertyPath(path, key, index);
    if ('value' in descriptor) {
      return {
        key: encodePropertyKey(key),
        descriptor: {
          kind: 'data',
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          writable: descriptor.writable,
        },
        value: toJsonSafe(descriptor.value, seen, propertyPath),
      };
    }
    return {
      key: encodePropertyKey(key),
      descriptor: {
        kind: 'accessor',
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
      },
      get: descriptor.get ? toJsonSafe(descriptor.get, seen, `${propertyPath}.<get>`) : null,
      set: descriptor.set ? toJsonSafe(descriptor.set, seen, `${propertyPath}.<set>`) : null,
    };
  });
}

function getOwnKeys(value) {
  try {
    return { keys: Reflect.ownKeys(value) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      keys: [],
    };
  }
}

function inspectObjectPrototype(value) {
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype) {
      return {
        audit: { kind: 'ordinary', constructor: 'Object' },
        constructorName: 'Object',
        isPlain: true,
      };
    }
    if (prototype === null) {
      return {
        audit: { kind: 'null', constructor: null },
        constructorName: null,
        isPlain: false,
      };
    }
    let constructorName = null;
    try {
      constructorName = prototype.constructor?.name ?? null;
    } catch {
      constructorName = null;
    }
    return {
      audit: { kind: 'custom', constructor: constructorName },
      constructorName,
      isPlain: false,
    };
  } catch (error) {
    return {
      audit: { kind: 'uninspectable', constructor: null, error: errorMessage(error) },
      constructorName: null,
      isPlain: false,
    };
  }
}

function getConstructorName(value) {
  return inspectObjectPrototype(value).constructorName;
}

function isErrorValue(value) {
  if (value instanceof Error) {
    return true;
  }
  try {
    return Object.prototype.toString.call(value) === '[object Error]'
      || getConstructorName(value)?.endsWith('Error') === true;
  } catch {
    return false;
  }
}

function taggedUninspectableValue(type, reason, value, seen, path) {
  const { keys, error } = getOwnKeys(value);
  return taggedJsonValue(type, {
    uninspectable: true,
    reason,
    ...(error ? { propertyInspectionError: error } : {}),
    properties: encodeOwnProperties(value, keys, seen, path),
  });
}

function toJsonSafeValue(value, seen = new WeakMap(), path = '$') {
  if (value === null) return null;
  if (value === undefined) return taggedJsonValue('undefined');
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return taggedJsonValue('number', { value: 'NaN' });
    if (value === Number.POSITIVE_INFINITY) return taggedJsonValue('number', { value: 'Infinity' });
    if (value === Number.NEGATIVE_INFINITY) return taggedJsonValue('number', { value: '-Infinity' });
    if (Object.is(value, -0)) return taggedJsonValue('number', { value: '-0' });
    return value;
  }
  if (typeof value === 'bigint') return taggedJsonValue('bigint', { value: value.toString() });
  if (typeof value === 'symbol') return taggedJsonValue('symbol', encodePropertyKey(value));
  if (typeof value === 'function') {
    return taggedJsonValue('function', { name: value.name, source: String(value) });
  }
  if (typeof value !== 'object') {
    return taggedJsonValue('unknown', { value: String(value) });
  }

  const referencePath = seen.get(value);
  if (referencePath) {
    return taggedJsonValue('reference', { path: referencePath });
  }
  seen.set(value, path);

  if (value instanceof WeakMap) {
    return taggedUninspectableValue(
      'weak-map',
      'WeakMap entries cannot be synchronously enumerated.',
      value,
      seen,
      path,
    );
  }
  if (value instanceof WeakSet) {
    return taggedUninspectableValue(
      'weak-set',
      'WeakSet values cannot be synchronously enumerated.',
      value,
      seen,
      path,
    );
  }
  if (value instanceof Promise) {
    return taggedUninspectableValue(
      'promise',
      'Promise state and result cannot be synchronously inspected.',
      value,
      seen,
      path,
    );
  }
  if (isErrorValue(value)) {
    const { keys, error } = getOwnKeys(value);
    return taggedJsonValue('error', {
      name: readPropertyForAudit(value, 'name', seen, `${path}.name`),
      ...(error ? { propertyInspectionError: error } : {}),
      properties: encodeOwnProperties(value, keys, seen, path),
    });
  }
  if (value instanceof Date) {
    return taggedJsonValue('date', {
      value: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString(),
    });
  }
  if (value instanceof RegExp) {
    return taggedJsonValue('regexp', {
      source: value.source,
      flags: value.flags,
      lastIndex: value.lastIndex,
    });
  }
  if (value instanceof Map) {
    return taggedJsonValue('map', {
      entries: Array.from(value.entries(), ([key, entry], index) => [
        toJsonSafe(key, seen, `${path}.<map-key:${index}>`),
        toJsonSafe(entry, seen, `${path}.<map-value:${index}>`),
      ]),
    });
  }
  if (value instanceof Set) {
    return taggedJsonValue('set', {
      values: Array.from(value.values(), (entry, index) => (
        toJsonSafe(entry, seen, `${path}.<set-value:${index}>`)
      )),
    });
  }
  if (typeof URL !== 'undefined' && value instanceof URL) {
    return taggedJsonValue('url', { value: value.href });
  }
  if (ArrayBuffer.isView(value)) {
    return taggedJsonValue('typed-array', {
      name: value.constructor.name,
      bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    });
  }
  if (value instanceof ArrayBuffer) {
    return taggedJsonValue('array-buffer', { bytes: Array.from(new Uint8Array(value)) });
  }
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    return taggedJsonValue('shared-array-buffer', { bytes: Array.from(new Uint8Array(value)) });
  }
  if (Array.isArray(value)) {
    const items = Array.from({ length: value.length }, (_, index) => {
      const inspected = inspectOwnPropertyDescriptor(value, String(index));
      if (inspected.error) {
        return taggedJsonValue('property-inspection-error', { message: inspected.error });
      }
      const descriptor = inspected.descriptor;
      if (!descriptor) {
        return taggedJsonValue('array-hole');
      }
      if (!('value' in descriptor)) {
        return taggedJsonValue('array-accessor', {
          get: descriptor.get ? toJsonSafe(descriptor.get, seen, `${path}[${index}].<get>`) : null,
          set: descriptor.set ? toJsonSafe(descriptor.set, seen, `${path}[${index}].<set>`) : null,
        });
      }
      return toJsonSafe(descriptor.value, seen, `${path}[${index}]`);
    });
    const { keys, error } = getOwnKeys(value);
    const extraKeys = keys.filter((key) => {
      if (key === 'length') return false;
      if (typeof key === 'symbol') return true;
      if (!/^(0|[1-9]\d*)$/.test(key)) return true;
      const index = Number(key);
      return index >= value.length || index >= 4_294_967_295;
    });
    if (extraKeys.length === 0 && !error) {
      return items;
    }
    return taggedJsonValue('array', {
      items,
      ...(error ? { propertyInspectionError: error } : {}),
      properties: encodeOwnProperties(value, extraKeys, seen, path),
    });
  }

  const { keys, error } = getOwnKeys(value);
  const prototypeInfo = inspectObjectPrototype(value);
  const encodeTaggedObject = () => taggedJsonValue('object', {
    constructor: prototypeInfo.constructorName,
    prototype: prototypeInfo.audit,
    ...(error ? { propertyInspectionError: error } : {}),
    properties: encodeOwnProperties(value, keys, seen, path),
  });
  const requiresTaggedProperties = Boolean(error)
    || !prototypeInfo.isPlain
    || keys.some((key) => typeof key === 'symbol' || key === JSON_SAFE_TAG_KEY)
    || keys.some((key) => {
      const inspected = inspectOwnPropertyDescriptor(value, key);
      const descriptor = inspected.descriptor;
      return Boolean(inspected.error)
        || !descriptor
        || !descriptor.enumerable
        || !('value' in descriptor);
    });
  if (requiresTaggedProperties) {
    return encodeTaggedObject();
  }

  const record = {};
  for (const key of keys) {
    const inspected = inspectOwnPropertyDescriptor(value, key);
    const descriptor = inspected.descriptor;
    if (inspected.error || !descriptor || !('value' in descriptor)) {
      return encodeTaggedObject();
    }
    defineJsonProperty(record, key, toJsonSafe(descriptor.value, seen, jsonValuePath(path, key)));
  }
  return record;
}
