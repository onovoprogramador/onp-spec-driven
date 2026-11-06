// Parser de spec.md — extrai histórias (US), critérios de aceite (AC),
// suposições (ASM) e perguntas em aberto (Q).
//
// A gramática é markdown humano com âncoras mecânicas:
//   ### US-001 — Título
//   #### AC-001 — Título
//   - **Dado** ... / - **Quando** ... / - **Então** ...
//   Tabelas em "## Suposições" e "## Perguntas em aberto".

import { DASH, splitLines, tableCells, isTableSeparator } from '../util/text.js';

const RE_META = /^>\s*(feature|status)\s*:\s*(.+?)\s*$/;
const RE_STORY = new RegExp(`^###\\s+(US-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*$`);
const RE_AC = new RegExp(`^####\\s+(AC-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*$`);
// aceita indentação (lista aninhada), marcador -/* e keyword sem case rígido
const RE_GWT = /^\s*[-*]\s*\*\*(Dado|Quando|Então|Entao|E)\*\*\s*(.+?)\s*$/i;
const RE_SECTION = /^##\s+(.+?)\s*$/;
// IDs de 1-2 dígitos em headings: quase-IDs que a gramática não reconhece
const RE_SHORT_ID = /^#{3,4}\s+((?:US|AC)-\d{1,2})\b/;

export const SPEC_STATUSES = ['rascunho', 'pronta', 'em-implementacao', 'implementada', 'auditada'];
export const ASM_STATUSES = ['aberta', 'confirmada', 'invalidada'];
export const Q_STATUSES = ['aberta', 'respondida'];

function normalizeSection(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function parseSpec(content, { file = 'spec.md' } = {}) {
  const lines = splitLines(content);
  const spec = {
    file,
    title: null,
    feature: null,
    status: null,
    stories: [],
    assumptions: [],
    questions: [],
    parseIssues: [],
    sections: { suposicoes: false, perguntas: false },
  };

  let currentStory = null;
  let currentAc = null;
  let currentSection = null; // 'suposicoes' | 'perguntas' | other
  let inTableHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (spec.title === null) {
      const h1 = line.match(/^#\s+(.+?)\s*$/);
      if (h1) {
        spec.title = h1[1];
        continue;
      }
    }

    const meta = line.match(RE_META);
    if (meta) {
      if (meta[1] === 'feature') spec.feature = meta[2];
      if (meta[1] === 'status') spec.status = meta[2];
      continue;
    }

    const section = line.match(RE_SECTION);
    if (section) {
      const norm = normalizeSection(section[1]);
      if (norm.startsWith('suposic')) {
        currentSection = 'suposicoes';
        spec.sections.suposicoes = true;
      } else if (norm.startsWith('perguntas')) {
        currentSection = 'perguntas';
        spec.sections.perguntas = true;
      } else currentSection = norm;
      currentStory = null;
      currentAc = null;
      inTableHeader = false;
      continue;
    }

    const shortId = line.match(RE_SHORT_ID);
    if (shortId) {
      spec.parseIssues.push({
        code: 'ID_CURTO',
        line: lineNo,
        message: `"${shortId[1]}" tem menos de 3 dígitos e não é reconhecido — use ${shortId[1].replace(/\d+$/, (d) => d.padStart(3, '0'))}`,
      });
    }

    const story = line.match(RE_STORY);
    if (story) {
      currentStory = {
        id: story[1],
        title: story[2],
        line: lineNo,
        description: [],
        acs: [],
      };
      spec.stories.push(currentStory);
      currentAc = null;
      continue;
    }

    const ac = line.match(RE_AC);
    if (ac) {
      currentAc = {
        id: ac[1],
        title: ac[2],
        line: lineNo,
        storyId: currentStory ? currentStory.id : null,
        given: [],
        when: [],
        then: [],
      };
      if (currentStory) {
        currentStory.acs.push(currentAc);
      } else {
        spec.parseIssues.push({
          code: 'AC_FORA_DE_US',
          line: lineNo,
          message: `${ac[1]} definido fora de uma história de usuário (US)`,
        });
      }
      continue;
    }

    const gwt = line.match(RE_GWT);
    if (gwt && currentAc) {
      const kind = gwt[1].toLowerCase();
      const text = gwt[2];
      if (kind === 'dado') currentAc.given.push(text);
      else if (kind === 'quando') currentAc.when.push(text);
      else if (kind === 'então' || kind === 'entao') currentAc.then.push(text);
      else if (kind === 'e') {
        // "E" continua a última cláusula preenchida
        if (currentAc.then.length) currentAc.then.push(text);
        else if (currentAc.when.length) currentAc.when.push(text);
        else currentAc.given.push(text);
      }
      continue;
    }

    if (currentSection === 'suposicoes' || currentSection === 'perguntas') {
      const cells = tableCells(line);
      if (cells === null) continue;
      if (isTableSeparator(cells)) continue;
      const first = cells[0] || '';
      if (currentSection === 'suposicoes') {
        if (/^ASM-\d{3,}$/.test(first)) {
          spec.assumptions.push({
            id: first,
            text: cells[1] || '',
            status: (cells[2] || '').toLowerCase(),
            resolution: cells[3] || '',
            line: lineNo,
          });
        } else if (!inTableHeader && first.toLowerCase() !== 'id') {
          // primeira linha não-separadora sem ID válido: só sinaliza se parecer dado
          if (first && first.toLowerCase() !== 'id') {
            spec.parseIssues.push({
              code: 'ASM_ID_INVALIDO',
              line: lineNo,
              message: `linha de suposição sem ID ASM-xxx válido: "${first}"`,
            });
          }
        }
        if (first.toLowerCase() === 'id') inTableHeader = true;
      } else {
        if (/^Q-\d{3,}$/.test(first)) {
          spec.questions.push({
            id: first,
            text: cells[1] || '',
            status: (cells[2] || '').toLowerCase(),
            answer: cells[3] || '',
            line: lineNo,
          });
        } else if (first && first.toLowerCase() !== 'id' && !inTableHeader) {
          spec.parseIssues.push({
            code: 'Q_ID_INVALIDO',
            line: lineNo,
            message: `linha de pergunta sem ID Q-xxx válido: "${first}"`,
          });
        }
        if (first.toLowerCase() === 'id') inTableHeader = true;
      }
      continue;
    }

    if (currentStory && !currentAc && line.trim() && !line.startsWith('#')) {
      currentStory.description.push(line.trim());
    }
  }

  return spec;
}

// Lista achatada de todos os ACs da spec.
export function allAcs(spec) {
  return spec.stories.flatMap((s) => s.acs);
}
