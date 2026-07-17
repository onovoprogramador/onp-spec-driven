// Parser de tasks.md — tarefas T-xxx com Refs (US/AC) e Arquivos.
//
//   ## T-001 — Título [pendente|em-andamento|concluida]
//   - Refs: US-001, AC-001, AC-002
//   - Arquivos: src/models/entrega.js, src/routes/entrega.js

import { DASH, splitLines } from '../util/text.js';

const RE_TASK = new RegExp(
  `^##\\s+(T-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*\\[(pendente|em-andamento|concluida)\\]\\s*$`
);
const RE_TASK_NO_STATUS = new RegExp(`^##\\s+(T-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*$`);
const RE_REFS = /^-\s*Refs\s*:\s*(.+?)\s*$/i;
const RE_FILES = /^-\s*Arquivos\s*:\s*(.+?)\s*$/i;

export const TASK_STATUSES = ['pendente', 'em-andamento', 'concluida'];

export function parseTasks(content, { file = 'tasks.md' } = {}) {
  const lines = splitLines(content);
  const result = { file, tasks: [], parseIssues: [] };
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const task = line.match(RE_TASK);
    if (task) {
      current = {
        id: task[1],
        title: task[2],
        status: task[3],
        line: lineNo,
        refs: [],
        files: [],
      };
      result.tasks.push(current);
      continue;
    }

    const noStatus = line.match(RE_TASK_NO_STATUS);
    if (noStatus) {
      current = {
        id: noStatus[1],
        title: noStatus[2],
        status: 'pendente',
        line: lineNo,
        refs: [],
        files: [],
      };
      result.tasks.push(current);
      result.parseIssues.push({
        code: 'TASK_SEM_STATUS',
        line: lineNo,
        message: `${noStatus[1]} sem status explícito — assumindo [pendente]`,
      });
      continue;
    }

    if (!current) continue;

    const refs = line.match(RE_REFS);
    if (refs) {
      const ids = refs[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const id of ids) {
        if (/^(US|AC)-\d{3,}$/.test(id)) {
          current.refs.push(id);
        } else {
          result.parseIssues.push({
            code: 'REF_MALFORMADA',
            line: lineNo,
            message: `${current.id}: ref "${id}" não é US-xxx nem AC-xxx`,
          });
        }
      }
      continue;
    }

    const files = line.match(RE_FILES);
    if (files) {
      const paths = files[1]
        .split(/[,\s]+/)
        .map((s) => s.trim().replace(/^`|`$/g, ''))
        .filter(Boolean);
      current.files.push(...paths);
    }
  }

  return result;
}
