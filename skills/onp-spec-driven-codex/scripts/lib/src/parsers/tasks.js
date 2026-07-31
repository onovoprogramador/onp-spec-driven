// Parser de tasks.md — tarefas T-xxx com Refs (US/AC) e Arquivos.
//
//   ## T-001 — Título [pendente|em-andamento|concluida]
//   - Refs: US-001, AC-001, AC-002
//   - Arquivos: src/models/entrega.js, src/routes/entrega.js
//
// Status é normalizado (minúsculas, sem acento): "[Concluída]" conta como
// concluida. Token desconhecido em [...] vira TASK_STATUS_INVALIDO — nunca
// degrada para "pendente" em silêncio (furaria o gate TASK_CONCLUIDA_SEM_PROVA).

import { DASH, splitLines, foldStatus } from '../util/text.js';

const RE_TASK_ANY = new RegExp(`^##\\s+(T-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*$`);
const RE_STATUS_SUFFIX = /^(.*?)\s*\[([^\]]+)\]\s*$/;
const RE_REFS = /^\s*[-*]\s*Refs\s*:\s*(.+?)\s*$/i;
const RE_FILES = /^\s*[-*]\s*Arquivos\s*:\s*(.+?)\s*$/i;
// campos opcionais usados pelo plano de execução (onp-spec plano)
const RE_MODEL = /^\s*[-*]\s*Modelo\s*:\s*(.+?)\s*$/i;
const RE_EFFORT = /^\s*[-*]\s*Esfor[cç]o\s*:\s*(.+?)\s*$/i;

export const TASK_STATUSES = ['pendente', 'em-andamento', 'concluida'];

export function parseTasks(content, { file = 'tasks.md' } = {}) {
  const lines = splitLines(content);
  const result = { file, tasks: [], parseIssues: [] };
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const task = line.match(RE_TASK_ANY);
    if (task) {
      let title = task[2];
      let status = null;
      const suffix = title.match(RE_STATUS_SUFFIX);
      if (suffix) {
        const folded = foldStatus(suffix[2].trim());
        if (TASK_STATUSES.includes(folded)) {
          title = suffix[1].trim();
          status = folded;
        } else {
          title = suffix[1].trim();
          status = 'pendente';
          result.parseIssues.push({
            code: 'TASK_STATUS_INVALIDO',
            line: lineNo,
            message: `${task[1]}: status "[${suffix[2]}]" não é um de: ${TASK_STATUSES.join(', ')}`,
          });
        }
      } else {
        status = 'pendente';
        result.parseIssues.push({
          code: 'TASK_SEM_STATUS',
          line: lineNo,
          message: `${task[1]} sem status explícito — assumindo [pendente]`,
        });
      }
      current = { id: task[1], title, status, line: lineNo, refs: [], files: [], model: null, esforco: null };
      result.tasks.push(current);
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
      // separa APENAS por vírgula: caminhos com espaço são válidos
      const paths = files[1]
        .split(',')
        .map((s) => s.trim().replace(/^`|`$/g, ''))
        .filter(Boolean);
      current.files.push(...paths);
      continue;
    }

    const model = line.match(RE_MODEL);
    if (model) {
      current.model = model[1].replace(/^`|`$/g, '');
      continue;
    }

    const effort = line.match(RE_EFFORT);
    if (effort) {
      current.esforco = effort[1].replace(/^`|`$/g, '');
    }
  }

  return result;
}
