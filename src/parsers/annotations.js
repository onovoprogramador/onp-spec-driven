// Scanner de anotações em arquivos de teste e código.
//
// Convenção universal (funciona em qualquer framework/linguagem):
//   - tag no TÍTULO do teste ou em comentário: @spec:AC-001
//   - tag de princípio: @principle:P-001
//
// O scanner varre os arquivos casando os globs configurados e devolve
// todas as ocorrências com arquivo + linha.

import { readdirSync, readFileSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { globToRegExp, anyGlobMatch } from '../util/text.js';

const RE_SPEC_TAG = /@spec:(AC-\d{3,})/g;
const RE_PRINCIPLE_TAG = /@principle:(P-\d{3,})/g;

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.cs', '.php', '.swift',
  '.md', '.txt', '.sql', '.sh', '.vue', '.svelte',
]);

// Porção estática de um glob — tudo antes do primeiro `*`/`?`, cortada no
// último `/`. 'src/**' -> 'src' | 'src/**/*.test.*' -> 'src' | '*.md' -> ''
// | '../outro-repo/src/**' -> '../outro-repo/src'. É a partir daqui que o
// walk físico começa — permite que o walk saia de baixo de rootDir quando o
// glob usa `../` (globs não fazem I/O sozinhos: sem isso, nenhum arquivo
// fora de rootDir seria visitado, e `../` nunca casaria com nada).
function staticDirOf(glob) {
  const wildcardIdx = glob.search(/[*?]/);
  const prefix = wildcardIdx === -1 ? glob : glob.slice(0, wildcardIdx);
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash === -1 ? '' : prefix.slice(0, lastSlash);
}

export function walkFiles(rootDir, { includeGlobs, ignoreGlobs }) {
  const include = includeGlobs.map(globToRegExp);
  const ignore = ignoreGlobs.map(globToRegExp);
  const found = new Set();

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // path.relative devolve o `../` de volta quando `full` cai fora de
      // rootDir — é assim que um walk-root externo casa com um glob `../`.
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (anyGlobMatch(rel, ignore)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (anyGlobMatch(rel, include)) found.add(rel);
      }
    }
  }

  const walkRoots = new Set(includeGlobs.map((g) => path.resolve(rootDir, staticDirOf(g))));
  for (const root of walkRoots) walk(root);

  return [...found].sort();
}

export function scanAnnotations(rootDir, files) {
  const specTags = []; // { acId, file, line, text }
  const principleTags = []; // { principleId, file, line, text }

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (ext && !TEXT_EXTENSIONS.has(ext)) continue;
    let content;
    try {
      content = readFileSync(path.join(rootDir, rel), 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(RE_SPEC_TAG)) {
        specTags.push({ acId: m[1], file: rel, line: i + 1, text: line.trim() });
      }
      for (const m of line.matchAll(RE_PRINCIPLE_TAG)) {
        principleTags.push({ principleId: m[1], file: rel, line: i + 1, text: line.trim() });
      }
    }
  }

  return { specTags, principleTags };
}

// Procura ocorrências de um padrão regex em arquivos que casam um glob.
// Usado pelas verificações (proibido/obrigatório) da constituição.
//
// Roda em SUBPROCESSO com timeout: uma regex patológica vinda da constituição
// (ex.: `(a+)+$`) causaria catastrophic backtracking e travaria o gate para
// sempre — aqui ela é morta e vira um achado, não um DoS.
const GREP_TIMEOUT_MS = 5000;

const GREP_WORKER = `
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const { rootDir, pattern, files } = JSON.parse(input);
  const { readFileSync } = require('fs');
  const path = require('path');
  let re;
  try { re = new RegExp(pattern); } catch (err) {
    console.log(JSON.stringify({ error: 'regex inválida: ' + pattern + ' (' + err.message + ')', hits: [] }));
    return;
  }
  const hits = [];
  for (const rel of files) {
    let content;
    try { content = readFileSync(path.join(rootDir, rel), 'utf-8'); } catch { continue; }
    const lines = content.split(/\\r?\\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) hits.push({ file: rel, line: i + 1, text: lines[i].trim() });
    }
  }
  console.log(JSON.stringify({ error: null, hits }));
});
`;

export function grepPattern(rootDir, pattern, glob, ignoreGlobs) {
  const files = walkFiles(rootDir, { includeGlobs: [glob], ignoreGlobs });
  // regex inválida é acusada SEMPRE, mesmo com glob vazio (compilar é barato
  // e seguro; só a execução pode ser patológica)
  try {
    new RegExp(pattern);
  } catch (err) {
    return { error: `regex inválida: ${pattern} (${err.message})`, hits: [], files };
  }
  if (files.length === 0) return { error: null, hits: [], files };

  const proc = spawnSync(process.execPath, ['-e', GREP_WORKER], {
    input: JSON.stringify({ rootDir, pattern, files }),
    encoding: 'utf-8',
    timeout: GREP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (proc.signal || proc.status === null) {
    return {
      error: `regex \`${pattern}\` excedeu ${GREP_TIMEOUT_MS / 1000}s (possível catastrophic backtracking) — simplifique o padrão`,
      hits: [],
      files,
    };
  }
  try {
    const out = JSON.parse(proc.stdout);
    return { error: out.error, hits: out.hits, files };
  } catch {
    return { error: `falha ao executar a verificação regex \`${pattern}\``, hits: [], files };
  }
}
