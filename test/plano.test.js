// Plano de execução: agrupamento em faixas (arquivos disjuntos → paralelo,
// compartilhado → mesma faixa, sem Arquivos → sequencial) e renderizadores.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montarPlano,
  normalizarEsforco,
  renderPlanoMd,
  renderPlanoSh,
  renderPlanoHtml,
  renderPlanoJson,
} from '../src/core/plano.js';
import { DEFAULT_CONFIG } from '../src/config.js';

function projeto({ tasks, specStories = [], rootDir = '/tmp/repo-x' } = {}) {
  return {
    config: { ...DEFAULT_CONFIG, rootDir, testCommand: 'node --test' },
    features: [
      {
        name: 'pagamentos',
        spec: { stories: specStories },
        tasks: { tasks },
      },
    ],
  };
}

function t(id, { files = [], status = 'pendente', refs = [], model = null, esforco = null, line = 1 } = {}) {
  return { id, title: `Título ${id}`, status, line, refs, files, model, esforco };
}

test('esforço aceita PT e EN e normaliza para o nível do CLI', () => {
  assert.equal(normalizarEsforco('alto'), 'high');
  assert.equal(normalizarEsforco('Médio'), 'medium');
  assert.equal(normalizarEsforco('xalto'), 'xhigh');
  assert.equal(normalizarEsforco('MAX'), 'max');
  assert.equal(normalizarEsforco('low'), 'low');
  assert.equal(normalizarEsforco('turbo'), null);
});

test('arquivos disjuntos → faixas paralelas; compartilhado → mesma faixa; sem arquivos → sequencial', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-003', { files: ['src/a.js', 'src/c.js'], line: 9 }),
        t('T-004', { line: 13 }),
      ],
    }),
    'pagamentos',
    { agent: 'claude', enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.erro, plan.erro);
  assert.equal(plan.faixas.length, 2);
  assert.deepEqual(plan.faixas[0].tasks.map((x) => x.id), ['T-001', 'T-003']);
  assert.deepEqual(plan.faixas[1].tasks.map((x) => x.id), ['T-002']);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-004']);
  assert.equal(plan.faixas[0].branch, 'spec/pagamentos-faixa-1');
  assert.equal(plan.branchTrabalho, 'spec/pagamentos');
  // engine vira caminho relativo à raiz
  assert.equal(plan.engine, 'bin/onp-spec.js');
});

test('tarefas concluídas ficam de fora; tudo concluído é erro amigável', () => {
  const plan = montarPlano(
    projeto({
      tasks: [t('T-001', { files: ['src/a.js'], status: 'concluida' }), t('T-002', { files: ['src/b.js'] })],
    }),
    'pagamentos',
    {}
  );
  assert.deepEqual(plan.concluidas.map((x) => x.id), ['T-001']);
  assert.equal(plan.faixas.length, 1);

  const vazio = montarPlano(
    projeto({ tasks: [t('T-001', { files: ['src/a.js'], status: 'concluida' })] }),
    'pagamentos',
    {}
  );
  assert.match(vazio.erro, /já estão \[concluida\]/);
});

test('maxParalelas divide as faixas em ondas', () => {
  const proj = projeto({
    tasks: [
      t('T-001', { files: ['a'], line: 1 }),
      t('T-002', { files: ['b'], line: 2 }),
      t('T-003', { files: ['c'], line: 3 }),
      t('T-004', { files: ['d'], line: 4 }),
      t('T-005', { files: ['e'], line: 5 }),
    ],
  });
  proj.config.paralelo = { ...proj.config.paralelo, maxParalelas: 2 };
  const plan = montarPlano(proj, 'pagamentos', {});
  assert.equal(plan.faixas.length, 5);
  assert.deepEqual(plan.ondas.map((o) => o.length), [2, 2, 1]);
});

test('modelo e esforço por tarefa vencem o default; esforço inválido gera aviso', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['a'], model: 'claude-opus-5', esforco: 'alto' }),
        t('T-002', { files: ['b'], esforco: 'turbo' }),
      ],
    }),
    'pagamentos',
    {}
  );
  const [f1, f2] = plan.faixas;
  assert.equal(f1.tasks[0].model, 'claude-opus-5');
  assert.equal(f1.tasks[0].esforcoCli, 'high');
  assert.equal(f2.tasks[0].model, 'claude-sonnet-5'); // default da config
  assert.equal(f2.tasks[0].esforcoCli, 'medium'); // fallback
  assert.ok(plan.avisos.some((a) => a.includes('turbo')));
});

test('feature sem tasks.md ou inexistente é erro amigável', () => {
  const semTasks = { ...projeto({ tasks: [] }) };
  semTasks.features[0].tasks = null;
  assert.match(montarPlano(semTasks, 'pagamentos', {}).erro, /não tem tarefas/);
  assert.match(montarPlano(projeto({ tasks: [t('T-001')] }), 'outra', {}).erro, /não encontrada/);
});

function planPadrao(agent) {
  return montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], refs: ['AC-001'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5, esforco: 'alto' }),
        t('T-003', { line: 9 }),
      ],
      specStories: [{ id: 'US-001', acs: [{ id: 'AC-001', title: 'Cobrança criada' }] }],
    }),
    'pagamentos',
    { agent, enginePath: '/tmp/repo-x/bin/onp-spec.js', now: new Date('2026-07-28T12:00:00Z') }
  );
}

test('md (claude): faixas, gestão de branches, resumo por minuto, sem botão', () => {
  const md = renderPlanoMd(planPadrao('claude'));
  assert.match(md, /## Faixas e ondas/);
  assert.match(md, /spec\/pagamentos-faixa-1/);
  assert.match(md, /1 tarefa = 1 commit/);
  assert.match(md, /executar-tarefas\.sh/);
  // a escolha (quais paralelizar, ou uma após a outra) é do usuário
  assert.match(md, /onp-spec plano pagamentos --paralelizar T-xxx,T-yyy/);
  assert.match(md, /--sequencial/);
  // acompanhamento é resumo no chat/terminal — não existe mais painel/botão
  assert.match(md, /resumo geral de andamento/i);
  assert.match(md, /onp-spec resumo pagamentos/);
  assert.doesNotMatch(md, /painel/);
  assert.doesNotMatch(md, /Executar todas as tarefas em janelas limpas/);
  assert.match(md, /audit --ci/);
});

test('--paralelizar: só as escolhidas entram nas faixas; as demais viram sequenciais com motivo', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-003', { files: ['src/c.js'], line: 9 }),
        t('T-004', { line: 13 }),
      ],
    }),
    'pagamentos',
    { agent: 'claude', paralelizar: ['T-001', 'T-003'], enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.erro, plan.erro);
  assert.equal(plan.modo, 'paralelo');
  assert.deepEqual(plan.faixas.map((fx) => fx.tasks.map((x) => x.id)), [['T-001'], ['T-003']]);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-002', 'T-004'], 'fora da seleção roda ao final, na ordem');
  assert.match(plan.sequenciais[0].motivoSeq, /fora da seleção/);
  assert.match(plan.sequenciais[1].motivoSeq, /pegada desconhecida/);
  // ficar fora da seleção é decisão do usuário, não fallback — sem aviso
  assert.ok(!plan.avisos.some((a) => a.includes('T-002')));
  assert.deepEqual(plan.paralelizar, ['T-001', 'T-003']);
});

test('--paralelizar: escolhidas que compartilham arquivo caem na MESMA faixa', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/a.js', 'src/c.js'], line: 5 }),
        t('T-003', { files: ['src/b.js'], line: 9 }),
      ],
    }),
    'pagamentos',
    { paralelizar: ['T-001', 'T-002'] }
  );
  assert.equal(plan.faixas.length, 1, 'conflito de arquivo não vira paralelismo nem com seleção');
  assert.deepEqual(plan.faixas[0].tasks.map((x) => x.id), ['T-001', 'T-002']);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-003']);
});

test('--paralelizar: tarefa desconhecida ou seleção vazia é erro amigável', () => {
  const proj = () => projeto({ tasks: [t('T-001', { files: ['a'] }), t('T-002', { files: ['b'], status: 'concluida' })] });
  assert.match(
    montarPlano(proj(), 'pagamentos', { paralelizar: ['T-999'] }).erro,
    /T-999/,
    'id inexistente aparece no erro'
  );
  assert.match(
    montarPlano(proj(), 'pagamentos', { paralelizar: ['T-002'] }).erro,
    /não estão pendentes/,
    'tarefa concluída não é paralelizável'
  );
  assert.match(montarPlano(proj(), 'pagamentos', { paralelizar: [] }).erro, /--sequencial/);
});

test('--paralelizar aparece nos artefatos: md (seleção + regenere), json e sh', () => {
  const plan = montarPlano(
    projeto({
      tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
    }),
    'pagamentos',
    { agent: 'claude', paralelizar: ['T-001'], enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  const md = renderPlanoMd(plan);
  assert.match(md, /seleção do usuário.*T-001/);
  assert.match(md, /Regenere: `onp-spec plano pagamentos --paralelizar T-001`/);
  assert.match(md, /fora da seleção do usuário/);
  const dados = JSON.parse(renderPlanoJson(plan));
  assert.deepEqual(dados.paralelizar, ['T-001']);
  const sh = renderPlanoSh(plan);
  assert.match(sh, /sequencial T-002 \(fora da seleção do usuário\)/);
});

test('montarPlano --sequencial: sem faixas, tudo uma após a outra na ordem do tasks.md', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-003', { line: 9 }),
      ],
    }),
    'pagamentos',
    { agent: 'claude', sequencial: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.equal(plan.modo, 'sequencial');
  assert.equal(plan.faixas.length, 0);
  assert.equal(plan.ondas.length, 0);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-001', 'T-002', 'T-003'], 'ordem do tasks.md');
  // sem aviso de "pegada desconhecida": sequencial é escolha, não fallback
  assert.ok(!plan.avisos.some((a) => a.includes('pegada desconhecida')));
});

test('md/sh/html no modo sequencial: sem worktrees, ordem explícita, mesmo gate', () => {
  const proj = projeto({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = montarPlano(proj, 'pagamentos', { agent: 'claude', sequencial: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });

  const md = renderPlanoMd(plan);
  assert.match(md, /modo SEQUENCIAL \(escolha do usuário\)/);
  assert.match(md, /## Ordem de execução \(uma tarefa após a outra\)/);
  assert.doesNotMatch(md, /## Faixas e ondas/);
  assert.match(md, /sem worktrees e sem paralelismo/);
  assert.doesNotMatch(md, /git worktree|1 faixa = 1 worktree/);
  assert.match(md, /audit --ci/);

  const sh = renderPlanoSh(plan);
  assert.match(sh, /executar_seq_T_001/);
  assert.match(sh, /executar_seq_T_002/);
  assert.doesNotMatch(sh, /executar_faixa_/);
  assert.match(sh, /rodar_gate/);

  const html = renderPlanoHtml(plan);
  assert.match(html, /modo <b>sequencial<\/b> \(escolha do usuário\)/);
  assert.match(html, /Ordem de execução/);

  const dados = JSON.parse(renderPlanoJson(plan));
  assert.equal(dados.modo, 'sequencial');
  assert.deepEqual(dados.faixas, []);
  assert.equal(dados.sequenciais.length, 2);
});

test('md (antigravity, sequencial): prompts na ordem, sem worktrees, resumo do agente', () => {
  const proj = projeto({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = montarPlano(proj, 'pagamentos', { agent: 'antigravity', sequencial: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });
  const md = renderPlanoMd(plan);
  assert.match(md, /Sequencial no Antigravity/);
  assert.match(md, /Prompt — T-001/);
  assert.match(md, /Prompt — T-002/);
  assert.doesNotMatch(md, /git worktree add/);
  assert.match(md, /resumo pagamentos --gravar --origem ia --texto/);
  assert.doesNotMatch(md, /claude -p/);
});

test('md (antigravity): worktrees, prompt por faixa, sem claude CLI', () => {
  const md = renderPlanoMd(planPadrao('antigravity'));
  assert.match(md, /git worktree add \.\.\/onp-worktrees\/repo-x-pagamentos-faixa-1/);
  assert.match(md, /Prompt — faixa-1/);
  assert.match(md, /NUNCA enfraqueça, pule \(skip\/todo\) ou apague um teste/);
  assert.match(md, /node bin\/onp-spec\.js tarefa pagamentos T-001 concluida/);
  assert.doesNotMatch(md, /claude -p/, 'plano do Antigravity não pode depender do CLI do Claude');
});

test('sh: claude -p com model/effort por tarefa, stream-json, worktrees e merge', () => {
  const sh = renderPlanoSh(planPadrao('claude'));
  assert.match(sh, /^#!\/usr\/bin\/env bash/);
  assert.match(sh, /claude -p "\$3" --model "\$4" --effort "\$5" "\$\{STREAM_FLAGS\[@\]}"/);
  assert.match(sh, /STREAM_FLAGS=\(--output-format stream-json --verbose\)/);
  // o prompt vai inline (multilinha) entre a tarefa e o modelo/esforço
  assert.match(sh, /rodar_tarefa 'faixa-1' 'T-001' '[\s\S]*?' 'claude-sonnet-5' medium/);
  assert.match(sh, /rodar_tarefa 'faixa-2' 'T-002' '[\s\S]*?' 'claude-sonnet-5' high/); // esforço alto da tarefa
  assert.match(sh, /--permission-mode acceptEdits/);
  assert.match(sh, /Bash\(node:\*\)/); // allowedTools derivada do testCommand
  assert.match(sh, /git worktree add "\$3" -b/);
  assert.match(sh, /mesclar_faixa 'faixa-1'/);
  assert.match(sh, /marcar_concluidas T-001/); // T-003 não tem Arquivos: → sequencial
  assert.match(sh, /audit --ci/);
  assert.match(sh, /executar_seq_T_003/); // tarefa sem arquivos vira função própria
  // eventos para o ledger global (o painel ao vivo lê deles)
  assert.match(sh, /evento\(\) \{ node "\$ENGINE" evento --run "\$RUN_ID"/);
  assert.match(sh, /evento --tipo faixa --faixa 'faixa-1' --estado executando/);
  assert.match(sh, /evento --tipo gate --etapa audit --exit "\$AUDIT"/);
  assert.match(sh, /RUN_ID='repo-x-pagamentos/);
});

test('sh: dispatcher permite reexecutar UMA faixa, UMA sequencial, ou só o gate', () => {
  const sh = renderPlanoSh(planPadrao('claude'));
  // uma função por faixa e por sequencial = alvo isolável
  assert.match(sh, /executar_faixa_1\(\) \{/);
  assert.match(sh, /executar_faixa_2\(\) \{/);
  assert.match(sh, /executar_seq_T_003\(\) \{/);
  // parsing de argumentos
  assert.match(sh, /--faixa\) MODO="faixa"; ALVO="\$\{2:-}"; shift ;;/);
  assert.match(sh, /--seq\) MODO="seq"/);
  assert.match(sh, /--gate\) MODO="gate"/);
  assert.match(sh, /--listar\) MODO="listar"/);
  assert.match(sh, /--sem-gate\) COM_GATE=0/);
  // despacho por alvo (com o resumo periódico ligado), faixa desconhecida barrada
  assert.match(sh, /faixa-1\) evento --tipo inicio --escopo "faixa:faixa-1"; iniciar_resumos; executar_faixa_1/);
  assert.match(sh, /falhar "faixa desconhecida/);
  assert.match(sh, /falhar "tarefa sequencial desconhecida/);
  // worktree de tentativa anterior é limpo antes de recriar
  assert.match(sh, /git worktree remove --force "\$3"/);
  assert.match(sh, /git branch -D "\$2"/);
  assert.match(sh, /tentativa\(\)/);
  // a dica de reexecução aparece quando algo falha
  assert.match(sh, /reexecute só ela: bash .*--faixa \$1/);
});

test('sh: resumo geral de andamento a cada minuto (IA com fallback do motor)', () => {
  const sh = renderPlanoSh(planPadrao('claude'));
  assert.match(sh, /gerar_resumo\(\)/);
  assert.match(sh, /sleep 60; gerar_resumo/);
  assert.match(sh, /resumo "\$FEATURE" --contexto/);
  assert.match(sh, /--gravar --origem ia --texto "\$ia"/);
  assert.match(sh, /RESUMO_MODEL='claude-haiku-4-5'/);
  // sem IA disponível, o resumo do motor entra no lugar (nunca silêncio)
  assert.match(sh, /resumo "\$FEATURE" --gravar >\/dev\/null/);
  // o texto aparece no terminal, para quem acompanha por lá
  assert.match(sh, /📣 resumo/);
  // ao sair: mata o loop E o sleep filho (pipe não fica preso) e grava o final
  assert.match(sh, /pkill -P "\$RESUMO_PID"/);
  assert.match(sh, /trap 'parar_resumos; node "\$ENGINE" resumo "\$FEATURE" --gravar/);
});

test('sh: --sem-gate NUNCA anuncia alinhamento (não existe prova sem audit)', () => {
  const sh = renderPlanoSh(planPadrao('claude'));
  const semGate = sh.slice(sh.indexOf('if [ "$COM_GATE" -eq 0 ]'), sh.indexOf('rodar_gate\n  local audit'));
  assert.match(semGate, /NÃO é prova de nada/);
  assert.doesNotMatch(semGate, /audit exit 0/, 'sem rodar o audit, nada de dizer que saiu 0');
  assert.match(semGate, /evento --tipo fim --exit 1/, 'ledger registra que não houve veredito');
  // a frase de alinhamento só existe no caminho que roda o gate
  const comGate = sh.slice(sh.indexOf('rodar_gate\n  local audit'));
  assert.match(comGate, /audit exit 0/);
});

test('plano.json: estrutura de máquina para o painel e outras ferramentas', async () => {
  const { renderPlanoJson } = await import('../src/core/plano.js');
  const dados = JSON.parse(renderPlanoJson(planPadrao('claude')));
  assert.equal(dados.feature, 'pagamentos');
  assert.deepEqual(dados.ondas, [['faixa-1', 'faixa-2']]);
  assert.equal(dados.faixas[0].tarefas[0].id, 'T-001');
  assert.equal(dados.faixas[0].tarefas[0].esforco, 'medium');
  assert.equal(dados.sequenciais[0].id, 'T-003');
  assert.match(dados.logsDir, /onp-worktrees\/repo-x-pagamentos-logs/);
});

test('html: visual sem botão, comando visível, tema e escape de conteúdo hostil', () => {
  const proj = projeto({
    tasks: [t('T-001', { files: ['src/a.js'] })],
  });
  proj.features[0].tasks.tasks[0].title = 'Tarefa <script>alert(1)</script> & "aspas"';
  const plan = montarPlano(proj, 'pagamentos', { agent: 'claude' });
  const html = renderPlanoHtml(plan);
  // execução é via agente: o html não tem botão nem clipboard
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /navigator\.clipboard/);
  assert.match(html, /via agente/);
  assert.match(html, /bash \.spec\/features\/pagamentos\/executar-tarefas\.sh/);
  assert.match(html, /resumo geral de andamento/i);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'título precisa sair escapado');
  assert.match(html, /&lt;script&gt;/);
});

test('sh: título com aspas simples não quebra o quoting do bash', () => {
  const proj = projeto({ tasks: [t('T-001', { files: ['src/a.js'] })] });
  proj.features[0].tasks.tasks[0].title = `fluxo "d'água" & $HOME \`id\``;
  const sh = renderPlanoSh(montarPlano(proj, 'pagamentos', { agent: 'claude' }));
  // dentro de aspas simples, a única sequência sensível é a própria aspa — escapada
  assert.match(sh, /d'\\''água/);
});
