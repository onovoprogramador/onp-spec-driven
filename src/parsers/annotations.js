// Scanner de anotações em arquivos de teste e código.
//
// Convenção universal (funciona em qualquer framework/linguagem):
//   - tag no TÍTULO do teste ou em comentário: @spec:AC-001
//   - tag de princípio: @principle:P-001
//
// O scanner varre os arquivos casando os globs configurados e devolve
// todas as ocorrências com arquivo + linha.

import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { globToRegExp, anyGlobMatch } from '../util/text.js';

const RE_SPEC_TAG = /@spec:(AC-\d{3,})/g;
const RE_PRINCIPLE_TAG = /@principle:(P-\d{3,})/g;

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.cs', '.php', '.swift',
  '.md', '.txt', '.sql', '.sh', '.vue', '.svelte',
]);

export function walkFiles(rootDir, { includeGlobs, ignoreGlobs }) {
  const include = includeGlobs.map(globToRegExp);
  const ignore = ignoreGlobs.map(globToRegExp);
  const found = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (anyGlobMatch(rel, ignore)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (anyGlobMatch(rel, include)) found.push(rel);
      }
    }
  }

  walk(rootDir);
  return found.sort();
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
export function grepPattern(rootDir, pattern, glob, ignoreGlobs) {
  const files = walkFiles(rootDir, { includeGlobs: [glob], ignoreGlobs });
  let re;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    return { error: `regex inválida: ${pattern} (${err.message})`, hits: [], files };
  }
  const hits = [];
  for (const rel of files) {
    let content;
    try {
      content = readFileSync(path.join(rootDir, rel), 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file: rel, line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return { error: null, hits, files };
}
