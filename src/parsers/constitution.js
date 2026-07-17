// Parser de constituicao.md — princípios P-xxx com nível de obrigação
// e verificações executáveis.
//
//   # Constituição — v1.0.0
//   ## P-001 [DEVE] Título do princípio
//   Texto livre do princípio.
//   - verificação(teste): @principle:P-001
//   - verificação(proibido): `regex` em `src/**/*.js`
//   - verificação(obrigatório): `regex` em `src/**/*.js`

import { splitLines } from '../util/text.js';

const RE_VERSION = /v(\d+\.\d+\.\d+)/;
const RE_PRINCIPLE = /^##\s+(P-\d{3,})\s+\[(DEVE|RECOMENDADO|PODE)\]\s*[—–-]?\s*(.+?)\s*$/;
// heading de princípio com QUALQUER coisa entre colchetes — para acusar nível
// inválido em vez de ignorar o princípio em silêncio
const RE_PRINCIPLE_ANY = /^##\s+(P-\d{3,})\s+\[([^\]]+)\]\s*[—–-]?\s*(.+?)\s*$/;
const RE_CHECK = /^\s*[-*]\s*verifica(?:ção|cao)\((teste|proibido|obrigat(?:ório|orio)|gate)\)\s*:\s*(.+?)\s*$/i;
const RE_PATTERN_GLOB = /^`(.+?)`\s+em\s+`(.+?)`$/;

export const OBLIGATION_LEVELS = ['DEVE', 'RECOMENDADO', 'PODE'];

export function parseConstitution(content, { file = 'constituicao.md' } = {}) {
  const lines = splitLines(content);
  const result = { file, version: null, principles: [], parseIssues: [] };
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (result.version === null && line.startsWith('#') && !line.startsWith('##')) {
      const v = line.match(RE_VERSION);
      if (v) result.version = v[1];
      continue;
    }

    const principle = line.match(RE_PRINCIPLE);
    if (principle) {
      current = {
        id: principle[1],
        level: principle[2],
        title: principle[3],
        line: lineNo,
        body: [],
        checks: [],
      };
      result.principles.push(current);
      continue;
    }

    const badLevel = line.match(RE_PRINCIPLE_ANY);
    if (badLevel) {
      result.parseIssues.push({
        code: 'NIVEL_INVALIDO',
        line: lineNo,
        message: `${badLevel[1]}: nível "[${badLevel[2]}]" não é um de: ${OBLIGATION_LEVELS.join(', ')} — princípio seria ignorado`,
      });
      // ainda registra o princípio (como DEVE, o mais conservador) para
      // que as verificações dele não sumam
      current = {
        id: badLevel[1],
        level: 'DEVE',
        title: badLevel[3],
        line: lineNo,
        body: [],
        checks: [],
      };
      result.principles.push(current);
      continue;
    }

    if (!current) continue;

    const check = line.match(RE_CHECK);
    if (check) {
      const kindRaw = check[1].toLowerCase();
      const kind = kindRaw.startsWith('obrigat') ? 'obrigatorio' : kindRaw;
      const value = check[2];

      if (kind === 'teste') {
        const tag = value.match(/@principle:(P-\d{3,})/);
        current.checks.push({
          kind: 'teste',
          principleTag: tag ? tag[1] : current.id,
          line: lineNo,
        });
      } else if (kind === 'gate') {
        // satisfeita pelo próprio mecanismo do audit (AC_SEM_TESTE/AC_SEM_PROVA
        // etc.) — usada por princípios "meta" como o P-001 do preset base
        current.checks.push({ kind: 'gate', line: lineNo });
      } else {
        const pg = value.match(RE_PATTERN_GLOB);
        if (pg) {
          current.checks.push({ kind, pattern: pg[1], glob: pg[2], line: lineNo });
        } else {
          result.parseIssues.push({
            code: 'VERIFICACAO_MALFORMADA',
            line: lineNo,
            message: `${current.id}: verificação(${kind}) precisa do formato \`regex\` em \`glob\``,
          });
        }
      }
      continue;
    }

    if (line.trim() && !line.startsWith('#')) current.body.push(line.trim());
  }

  return result;
}
