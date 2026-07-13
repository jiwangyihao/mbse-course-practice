import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ciValue = process.env.CI;
const normalizedCi = ciValue === undefined || ciValue === '' ? undefined : (ciValue === '0' || ciValue === 'false' ? 'false' : 'true');
const env = {
  ...process.env,
  ...(normalizedCi ? { CI: normalizedCi } : {}),
};
const quoteCmdArg = (value) => `"${String(value).replace(/"/g, '""')}"`;

const child = process.platform === 'win32'
  ? spawn(
      `${quoteCmdArg(path.join(repoRoot, 'node_modules', '.bin', 'tauri.cmd'))} ${args.map(quoteCmdArg).join(' ')}`,
      {
        stdio: 'inherit',
        windowsHide: true,
        shell: true,
        env,
      },
    )
  : spawn(path.join(repoRoot, 'node_modules', '.bin', 'tauri'), args, {
      stdio: 'inherit',
      windowsHide: true,
      env,
    });

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
child.once('error', (error) => {
  console.error(error);
  process.exit(1);
});
