#!/usr/bin/env node
// Expand test files in Node so Node 18 and Windows do not depend on shell globbing.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(path.join(root, 'test'))
  .filter((file) => file.endsWith('.test.js')).sort()
  .map((file) => path.join(root, 'test', file));
if (!files.length) throw new Error('Nenhum arquivo de teste encontrado');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
