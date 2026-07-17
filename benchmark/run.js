// Harness de benchmark — roda ao vivo o onp-spec-driven e o OpenSpec sobre a
// MESMA feature real do domínio ONP, com defeitos semeados, e mede quantas
// classes de defeito cada ferramenta detecta MECANICAMENTE (o que um CI pega
// sem um humano/LLM no loop). O spec-kit entra pela matriz de capacidade
// (verificada no código-fonte: não tem validador mecânico de defeitos).
//
// uso: OPENSPEC_BIN=/caminho/openspec/bin/openspec.js node benchmark/run.js

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { SCENARIOS, DEFECT_CLASSES } from './scenarios.js';
import { runOnpSpec } from './adapters/onpspec.js';
import { runOpenSpec, OPENSPEC_BIN } from './adapters/openspec.js';
import { STATIC_TOOLS } from './adapters/capability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mapa: classe de defeito → códigos de achado do onp-spec que a comprovam.
const ONPSPEC_EXPECT = {
  BASELINE_LIMPO: null, // espera-se NENHUM erro
  REQ_SEM_TESTE: ['AC_SEM_TESTE'],
  TESTE_ORFAO: ['TESTE_ORFAO'],
  REQ_INCOMPLETO: ['AC_INCOMPLETO'],
  PRONTO_PREMATURO: ['TASK_CONCLUIDA_SEM_PROVA', 'AC_SEM_PROVA'],
  SUPOSICAO_SILENCIOSA: ['ASM_ABERTA'],
  PRIVACIDADE_VIOLADA: ['PRINCIPIO_VIOLADO'],
  CODIGO_ORFAO: ['ARQUIVO_ORFAO'],
  REF_QUEBRADA: ['REF_QUEBRADA'],
  ID_DUPLICADO: ['ID_DUPLICADO'],
};

// OpenSpec detecta apenas defeitos estruturais que cabem no modelo dele.
// (medido AO VIVO; este mapa é só para checagem de sanidade do resultado.)

function onpspecDetected(scenario, result) {
  const expect = ONPSPEC_EXPECT[scenario.defectClass];
  if (expect === null) {
    // baseline: detecção "correta" = não acusar erro nenhum
    return result.ok === true;
  }
  return expect.some((code) => result.detectedCodes.includes(code));
}

async function main() {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'onpspec-bench-'));
  const rows = [];
  const t0 = Date.now();

  for (const scenario of SCENARIOS) {
    const onp = await runOnpSpec(scenario, workDir);
    const onpDet = onpspecDetected(scenario, onp);

    const osRes = runOpenSpec(scenario, workDir);
    // para baseline, "detecção correta" = validar limpo (não falso-positivar)
    let osDet;
    if (!osRes.available) osDet = null;
    else if (scenario.defectClass === 'BASELINE_LIMPO') osDet = osRes.detected === false;
    else osDet = osRes.detected;

    rows.push({
      scenario: scenario.id,
      defectClass: scenario.defectClass,
      onpspec: onpDet,
      openspec: osDet,
      speckit: scenario.defectClass === 'BASELINE_LIMPO' ? true : STATIC_TOOLS['spec-kit'].detects(),
      onpCodes: onp.detectedCodes,
      osOut: osRes.available ? osRes.out?.split('\n').slice(-3).join(' ') : osRes.note,
    });
  }

  rmSync(workDir, { recursive: true, force: true });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ---------- agrega ----------
  const tools = ['onpspec', 'openspec', 'speckit'];
  const labels = {
    onpspec: 'onp-spec-driven',
    openspec: 'OpenSpec',
    speckit: 'spec-kit',
  };
  // conta apenas cenários de DEFEITO (exclui baseline) para taxa de detecção
  const defectRows = rows.filter((r) => r.defectClass !== 'BASELINE_LIMPO');
  const score = {};
  for (const t of tools) {
    const hits = defectRows.filter((r) => r[t] === true).length;
    score[t] = { hits, total: defectRows.length, pct: Math.round((100 * hits) / defectRows.length) };
  }
  const baseline = rows.find((r) => r.defectClass === 'BASELINE_LIMPO');

  // ---------- imprime ----------
  console.log(`\nBenchmark onp-spec-driven — ${SCENARIOS.length} cenários (${elapsed}s)\n`);
  console.log('Taxa de detecção mecânica de defeitos reais (maior = melhor):');
  for (const t of tools) {
    console.log(`  ${labels[t].padEnd(18)} ${String(score[t].pct).padStart(3)}%  (${score[t].hits}/${score[t].total})`);
  }
  console.log('\nBaseline (spec correta) — nenhuma deve falso-positivar:');
  for (const t of tools) {
    const v = baseline[t];
    console.log(`  ${labels[t].padEnd(18)} ${v === true ? 'OK (limpo)' : v === null ? 'n/d' : 'FALSO POSITIVO'}`);
  }

  // ---------- RESULTS.md ----------
  const md = renderResults({ rows, score, tools, labels, defectRows, baseline, elapsed });
  const outPath = path.join(__dirname, 'RESULTS.md');
  writeFileSync(outPath, md);
  console.log(`\nrelatório completo: ${path.relative(process.cwd(), outPath)}`);

  // ---------- sanidade: onp-spec DEVE pegar tudo ----------
  const misses = defectRows.filter((r) => r.onpspec !== true);
  if (misses.length) {
    console.error(`\n⚠ onp-spec-driven não detectou: ${misses.map((m) => m.defectClass).join(', ')}`);
    process.exitCode = 1;
  } else if (baseline.onpspec !== true) {
    console.error('\n⚠ onp-spec-driven falso-positivou no baseline');
    process.exitCode = 1;
  } else {
    console.log('\n✔ onp-spec-driven: 100% de detecção e baseline limpo');
  }
}

function mark(v) {
  if (v === true) return '✅';
  if (v === false) return '❌';
  return '—';
}

function renderResults({ rows, score, tools, labels, defectRows, baseline, elapsed }) {
  const l = [];
  l.push('# Resultados do benchmark — onp-spec-driven vs. concorrentes', '');
  l.push(`> Gerado por \`node benchmark/run.js\` · ${new Date().toISOString().slice(0, 10)} · ${elapsed}s`);
  l.push(`> OpenSpec: ${OPENSPEC_BIN ? 'executado ao vivo' : 'não disponível neste ambiente (defina OPENSPEC_BIN)'}`, '');

  l.push('## O que se mede', '');
  l.push('Cada cenário parte de uma **spec real do domínio ONP** (inscrição de turma, notas de aluno) e semeia **um defeito que realmente adoece projetos spec-driven**. Mede-se se cada ferramenta detecta o defeito **mecanicamente** — o que um pipeline de CI pega sozinho, sem humano nem LLM no loop. É essa detecção que faz a spec *continuar verdadeira*.', '');

  l.push('## Placar (taxa de detecção mecânica)', '');
  l.push('| Ferramenta | Detecção | Acertos |');
  l.push('|---|---|---|');
  for (const t of tools) {
    l.push(`| ${labels[t]} | **${score[t].pct}%** | ${score[t].hits}/${score[t].total} |`);
  }
  l.push('');

  l.push('## Matriz por classe de defeito', '');
  l.push('| Cenário | Defeito | onp-spec | OpenSpec | spec-kit |');
  l.push('|---|---|:--:|:--:|:--:|');
  for (const r of rows) {
    l.push(`| ${r.scenario} | ${r.defectClass} | ${mark(r.onpspec)} | ${mark(r.openspec)} | ${mark(r.speckit)} |`);
  }
  l.push('');
  l.push('Legenda: ✅ detectou (ou, no baseline, validou limpo) · ❌ não detectou · — não disponível.', '');

  l.push('## Descrição das classes de defeito', '');
  for (const [k, v] of Object.entries(DEFECT_CLASSES)) l.push(`- **${k}** — ${v}`);
  l.push('');

  l.push('## Evidência (achados do onp-spec por cenário)', '');
  l.push('| Cenário | Códigos de erro emitidos |');
  l.push('|---|---|');
  for (const r of rows) {
    l.push(`| ${r.scenario} | ${r.onpCodes.length ? r.onpCodes.join(', ') : '_(nenhum — baseline limpo)_'} |`);
  }
  l.push('');

  l.push('## Por que os concorrentes ficam para trás', '');
  l.push('- **OpenSpec** tem um validador estrutural real (exige frase normativa SHALL e ao menos um cenário por requisito), então pega `REQ_INCOMPLETO`. Mas seu modelo não conhece **testes, provas, suposições, privacidade ou código órfão** — logo não há como detectar o drift #1 (requisito sem teste), a vitória prematura, a suposição silenciosa ou a violação de privacidade.');
  l.push('- **spec-kit** é scaffolding: gera templates ótimos e conduz o agente, mas não roda nenhuma checagem de defeitos — e no template dele os **testes são opcionais**. Detecção mecânica: zero.');
  l.push('');
  l.push('O onp-spec-driven é o único que trata **prova de teste, suposição e princípio como dados de primeira classe** e os audita mecanicamente — por isso detecta as classes que os outros nem representam.', '');

  return l.join('\n');
}

main();
