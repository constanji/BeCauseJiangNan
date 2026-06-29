import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function resolveViteBin() {
  const candidates = [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(root, '..', 'node_modules', 'vite', 'bin', 'vite.js'),
  ];
  for (const candidate of candidates) {
    try {
      require.resolve(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error('找不到 vite，请在仓库根目录或 Schema 目录执行 npm install');
}

const viteBin = resolveViteBin();
const server = spawn(process.execPath, ['server/src/index.js'], { stdio: 'inherit', cwd: root, env: process.env });
const web = spawn(process.execPath, [viteBin, '--config', 'web/vite.config.ts'], { stdio: 'inherit', cwd: root, env: process.env });

const shutdown = () => {
  server.kill('SIGINT');
  web.kill('SIGINT');
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('exit', (code) => {
  if (code && code !== 0) web.kill('SIGINT');
});
web.on('exit', (code) => {
  if (code && code !== 0) server.kill('SIGINT');
});
