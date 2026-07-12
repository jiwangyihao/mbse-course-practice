import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import sysmlLsp from 'sysml-v2-lsp';

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

function createMessageReader(stream) {
  let buffer = Buffer.alloc(0);
  const messages = [];
  const waiters = new Set();

  const flush = () => {
    for (const waiter of [...waiters]) {
      const index = messages.findIndex(waiter.predicate);
      if (index < 0) {
        continue;
      }
      const [message] = messages.splice(index, 1);
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  };

  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        break;
      }
      const header = buffer.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const bodyLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + bodyLength) {
        break;
      }
      const body = buffer.subarray(bodyStart, bodyStart + bodyLength).toString('utf8');
      buffer = buffer.subarray(bodyStart + bodyLength);
      messages.push(JSON.parse(body));
    }
    flush();
  });

  return {
    waitFor(predicate, timeoutMs) {
      const existingIndex = messages.findIndex(predicate);
      if (existingIndex >= 0) {
        return Promise.resolve(messages.splice(existingIndex, 1)[0]);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`SysML LSP 在 ${timeoutMs}ms 内未返回预期消息。`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    rejectAll(error) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      waiters.clear();
    },
  };
}

function normalizeDiagnostic(diagnostic) {
  const start = diagnostic?.range?.start;
  const end = diagnostic?.range?.end;
  return {
    severity: typeof diagnostic?.severity === 'number' ? diagnostic.severity : 1,
    message: typeof diagnostic?.message === 'string' ? diagnostic.message : 'Unknown SysML diagnostic.',
    source: typeof diagnostic?.source === 'string' ? diagnostic.source : 'sysml',
    line: typeof start?.line === 'number' ? start.line + 1 : 1,
    column: typeof start?.character === 'number' ? start.character + 1 : 1,
    endLine: typeof end?.line === 'number' ? end.line + 1 : undefined,
    endColumn: typeof end?.character === 'number' ? end.character + 1 : undefined,
  };
}

export async function validateSysmlWithLsp({ workspaceRoot, filePath, text, timeoutMs = 30_000 }) {
  const child = spawn(process.execPath, [sysmlLsp.serverPath, '--stdio'], {
    cwd: workspaceRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const reader = createMessageReader(child.stdout);
  child.stdin.on('error', () => undefined);
  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  child.once('error', (error) => reader.rejectAll(error));
  child.once('exit', (code, signal) => {
    resolveExit({ code, signal });
    reader.rejectAll(new Error(`SysML LSP 提前退出：code=${String(code)} signal=${String(signal)} ${stderr}`));
  });

  const send = (message) => {
    child.stdin.write(encodeMessage(message));
  };

  try {
    const rootUri = pathToFileURL(workspaceRoot).href;
    const documentUri = pathToFileURL(filePath).href;
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: [{ uri: rootUri, name: 'mbse-agent-workspace' }],
      },
    });
    const initializeResult = await reader.waitFor((message) => message.id === 1, timeoutMs);
    if (initializeResult.error) {
      throw new Error(`SysML LSP initialize 失败：${initializeResult.error.message ?? JSON.stringify(initializeResult.error)}`);
    }

    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: documentUri,
          languageId: 'sysml',
          version: 1,
          text,
        },
      },
    });

    const isDiagnosticPublication = (message) =>
      message.method === 'textDocument/publishDiagnostics' && message.params?.uri === documentUri;
    let publication = await reader.waitFor(isDiagnosticPublication, timeoutMs);
    while (true) {
      const nextPublication = await reader.waitFor(isDiagnosticPublication, 750).catch(() => undefined);
      if (!nextPublication) {
        break;
      }
      publication = nextPublication;
    }
    const diagnostics = Array.isArray(publication.params?.diagnostics)
      ? publication.params.diagnostics.map(normalizeDiagnostic)
      : [];
    const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity <= 2);
    return {
      valid: blockingDiagnostics.length === 0,
      diagnostics,
    };
  } catch (error) {
    return {
      valid: false,
      diagnostics: [
        {
          severity: 1,
          message: `SysML parser/compiler 不可用或执行失败：${error instanceof Error ? error.message : String(error)}`,
          source: 'sysml-lsp',
          line: 1,
          column: 1,
        },
      ],
    };
  } finally {
    try {
      if (child.exitCode === null) {
        try {
          send({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: null });
          await reader.waitFor((message) => message.id === 2, 2_000).catch(() => undefined);
          send({ jsonrpc: '2.0', method: 'exit', params: null });
        } catch {
          // Preserve the verification result; cleanup failures are not parser diagnostics.
        }
      }
    } finally {
      const gracefulExit = await Promise.race([
        exitPromise.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!gracefulExit) {
        child.kill();
        await Promise.race([
          exitPromise,
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    }
  }
}
