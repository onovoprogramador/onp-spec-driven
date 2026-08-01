// E2E dos pontos multi-agente: init --agents (claude | antigravity | inválido),
// plano gerando os artefatos certos por agente (sh com sintaxe bash válida,
// html somente leitura, modo sequencial) e o comando tarefa.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-agents-'));
// ledger em pasta própria: teste NUNCA escreve no ~/.onp-spec do usuário
const homeOnp = path.join(root, '.onp-home');
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync('node', [BIN, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

test('init --agents inválido falha alto (exit 2), nada instalado', () => {
  const { code, out } = cli('init', '--agents', 'copilot');
  assert.equal(code, 2, out);
  assert.match(out, /--agents desconhecido/);
  assert.ok(
    !existsSync(path.join(root, '.claude')) &&
      !existsSync(path.join(root, '.agents')) &&
      !existsSync(path.join(root, '.cursor'))
  );
});

test('init --agents claude instala a skill do Claude em .claude/skills/', () => {
  const { code, out } = cli('init', '--agents', 'claude');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.claude', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  assert.match(readFileSync(skillMd, 'utf-8'), /agent: claude/);
});

test('init --agents antigravity instala a skill do Antigravity em .agents/skills/', () => {
  const { code, out } = cli('init', '--agents', 'antigravity');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const conteudo = readFileSync(skillMd, 'utf-8');
  assert.match(conteudo, /agent: antigravity/);
  assert.match(conteudo, /Antigravity/);
});

test('motor embarcado de uma skill NÃO instala a skill do outro agente como se fosse a certa', () => {
  // o motor embarcado da skill claude (fallback ../../..) não pode servir a
  // skill claude quando pedem antigravity — tem que avisar e instruir
  const embarcado = path.join(root, '.claude', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const proc = spawnSync('node', [embarcado, 'init', '--agents', 'antigravity'], {
    cwd: root,
    encoding: 'utf-8',
  });
  const out = `${proc.stdout}\n${proc.stderr}`;
  assert.equal(proc.status, 0, out);
  assert.match(out, /skill para Antigravity não encontrada/);
  assert.ok(!existsSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md')));
});

test('init --agents codex NÃO sobrescreve a skill do Antigravity (compartilham .agents/skills)', () => {
  assert.equal(cli('init', '--agents', 'antigravity').code, 0);
  const { code, out } = cli('init', '--agents', 'codex');
  assert.equal(code, 2, out);
  assert.match(out, /já contém a skill do agente "antigravity"/);
  assert.match(out, /rm -rf/);
  // a skill do Antigravity ficou intacta
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.match(readFileSync(skillMd, 'utf-8'), /agent: antigravity/);
});

test('init --agents codex instala a skill do Codex em .agents/skills/ (o diretório de skills do Codex)', () => {
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const { code, out } = cli('init', '--agents', 'codex');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const conteudo = readFileSync(skillMd, 'utf-8');
  assert.match(conteudo, /agent: codex/);
  assert.match(conteudo, /Codex/);
  // autossuficiente: o motor embarcado veio junto
  assert.ok(existsSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // e rodar de novo mantém, sem reclamar
  const denovo = cli('init', '--agents', 'codex');
  assert.equal(denovo.code, 0, denovo.out);
});

test('init --agents cursor instala a skill do Cursor em .cursor/skills/ (o diretório de skills do Cursor)', () => {
  const { code, out } = cli('init', '--agents', 'cursor');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const conteudo = readFileSync(skillMd, 'utf-8');
  assert.match(conteudo, /agent: cursor/);
  assert.match(conteudo, /Cursor/);
  // o Cursor exige name igual ao nome da pasta instalada
  assert.match(conteudo, /^name: onp-spec-driven$/m);
  // autossuficiente: o motor embarcado veio junto
  assert.ok(existsSync(path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // o Cursor também lê .agents/skills (e .claude/.codex por compatibilidade):
  // com a skill do codex instalada ali, o init AVISA o conflito de leitura
  assert.match(out, /também tem a skill do agente "codex"/);
  assert.match(out, /rm -rf \.agents\/skills\/onp-spec-driven/);
  // e rodar de novo mantém, sem erro (aviso não é bloqueio — a escolha é do usuário)
  const denovo = cli('init', '--agents', 'cursor');
  assert.equal(denovo.code, 0, denovo.out);
  assert.match(readFileSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md'), 'utf-8'), /agent: codex/);
});

const SPEC = `# Spec: Pagamentos

> feature: pagamentos
> status: em-implementacao

## Histórias

### US-001 — Cobrança do mês

Como financeiro, quero cobrança automática, para receber em dia.

#### AC-001 — Cobrança criada

- **Dado** um aluno ativo
- **Quando** o mês vira
- **Então** a cobrança aparece para o aluno

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
`;

const TASKS = `# Tasks: Pagamentos

> feature: pagamentos

## T-001 — Modelo de cobrança [pendente]

- Refs: US-001, AC-001
- Arquivos: src/models/cobranca.js

## T-002 — Envio de recibo [pendente]

- Refs: AC-001
- Arquivos: src/services/recibo.js
- Modelo: claude-opus-5
- Esforço: alto

## T-003 — Rota de cobrança [pendente]

- Refs: AC-001
- Arquivos: src/models/cobranca.js, src/routes/cobranca.js
`;

test('plano (claude): gera md + sh executável com bash válido + html somente leitura', () => {
  cli('new', 'pagamentos');
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  writeFileSync(path.join(dir, 'spec.md'), SPEC);
  writeFileSync(path.join(dir, 'tasks.md'), TASKS);

  const { code, out } = cli('plano', 'pagamentos', '--agents', 'claude');
  assert.equal(code, 0, out);
  assert.match(out, /PODEM RODAR EM PARALELO em 2 faixa\(s\)/);
  assert.match(out, /onde está cada coisa/);
  // a escolha é do usuário: a saída ensina a rota sequencial
  assert.match(out, /--sequencial/);
  // acompanhamento é o resumo — servidor/painel não existe mais
  assert.match(out, /resumo geral de andamento/i);
  assert.doesNotMatch(out, /painel/);

  const md = readFileSync(path.join(dir, 'plano-execucao.md'), 'utf-8');
  assert.match(md, /faixa-1/);
  assert.match(md, /T-001[\s\S]*T-003/); // mesma faixa (arquivo compartilhado)

  const shPath = path.join(dir, 'executar-tarefas.sh');
  assert.ok(statSync(shPath).mode & 0o100, 'script precisa ser executável');
  const bashN = spawnSync('bash', ['-n', shPath], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n falhou: ${bashN.stderr}`);
  const sh = readFileSync(shPath, 'utf-8');
  assert.match(sh, /rodar_tarefa 'faixa-2' 'T-002' '[\s\S]*?' 'claude-opus-5' high/); // T-002 sobrescreve
  assert.match(sh, /--output-format stream-json/); // stream do modelo p/ o painel
  assert.match(sh, /audit --ci/);

  // o dispatcher precisa aceitar reexecução por faixa de verdade
  const listar = spawnSync('bash', [shPath, '--listar'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(listar.status, 0, listar.stderr);
  assert.match(listar.stdout, /faixa-1\s+onda 1\s+T-001, T-003/);
  assert.match(listar.stdout, /faixa-2\s+onda 1\s+T-002/);
  assert.match(listar.stdout, /reexecutar uma faixa/);

  const html = readFileSync(path.join(dir, 'plano-execucao.html'), 'utf-8');
  assert.doesNotMatch(html, /<button/, 'execução é via agente — html sem botão');
  assert.match(html, /via agente/);

  const planoJson = JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8'));
  assert.equal(planoJson.agent, 'claude');
  assert.equal(planoJson.modo, 'paralelo');
  assert.equal(planoJson.faixas.length, 2);
});

test('plano --sequencial (claude): uma tarefa após a outra, sh válido, sem faixas', () => {
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  const { code, out } = cli('plano', 'pagamentos', '--agents', 'claude', '--sequencial');
  assert.equal(code, 0, out);
  assert.match(out, /SEQUENCIAL — escolha do usuário/);
  assert.match(out, /uma após a outra/);

  const planoJson = JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8'));
  assert.equal(planoJson.modo, 'sequencial');
  assert.deepEqual(planoJson.faixas, []);
  assert.deepEqual(planoJson.sequenciais.map((t) => t.id), ['T-001', 'T-002', 'T-003']);

  const shPath = path.join(dir, 'executar-tarefas.sh');
  const bashN = spawnSync('bash', ['-n', shPath], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n falhou: ${bashN.stderr}`);
  const listar = spawnSync('bash', [shPath, '--listar'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(listar.status, 0, listar.stderr);
  assert.match(listar.stdout, /seq\s+T-001/);
  assert.doesNotMatch(listar.stdout, /faixa-1/);

  // volta o plano paralelo para os testes seguintes
  assert.equal(cli('plano', 'pagamentos', '--agents', 'claude').code, 0);
});

test('plano (antigravity): md com prompts por faixa, sem sh/html novos e sem claude -p', () => {
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  rmSync(path.join(dir, 'executar-tarefas.sh'));
  rmSync(path.join(dir, 'plano-execucao.html'));

  const { code, out } = cli('plano', 'pagamentos', '--agents', 'antigravity');
  assert.equal(code, 0, out);
  assert.match(out, /agente novo \(janela limpa\) por faixa/);
  const md = readFileSync(path.join(dir, 'plano-execucao.md'), 'utf-8');
  assert.match(md, /Prompt — faixa-1/);
  assert.match(md, /Antigravity/);
  assert.doesNotMatch(md, /claude -p/);
  assert.ok(!existsSync(path.join(dir, 'executar-tarefas.sh')), 'antigravity não gera o sh');
  assert.ok(!existsSync(path.join(dir, 'plano-execucao.html')), 'antigravity não gera o html');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8')).agent, 'antigravity');
});

test('plano (codex): md + sh com codex exec (bash válido) + html — sem claude -p', () => {
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  const { code, out } = cli('plano', 'pagamentos', '--agents', 'codex');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(codex\)/);
  assert.match(out, /executor headless/);
  // T-002 pedia claude-opus-5 — no codex isso vira o default com aviso
  assert.match(out, /claude-opus-5/);

  const md = readFileSync(path.join(dir, 'plano-execucao.md'), 'utf-8');
  assert.match(md, /Execução — Codex headless \(codex exec\)/);
  assert.doesNotMatch(md, /claude -p/);

  const shPath = path.join(dir, 'executar-tarefas.sh');
  assert.ok(statSync(shPath).mode & 0o100, 'script precisa ser executável');
  const bashN = spawnSync('bash', ['-n', shPath], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n falhou: ${bashN.stderr}`);
  const sh = readFileSync(shPath, 'utf-8');
  assert.match(sh, /codex exec "\$3" --model "\$4" -c model_reasoning_effort="\$5"/);
  assert.match(sh, /STREAM_FLAGS=\(--json\)/);
  assert.match(sh, /--sandbox 'workspace-write'/);
  assert.match(sh, /rodar_tarefa 'faixa-2' 'T-002' '[\s\S]*?' 'gpt-5.6-terra' high/);
  assert.doesNotMatch(sh, /claude -p/);
  assert.match(sh, /audit --ci/);

  // dispatcher igual ao do claude: reexecução por faixa disponível
  const listar = spawnSync('bash', [shPath, '--listar'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(listar.status, 0, listar.stderr);
  assert.match(listar.stdout, /faixa-1\s+onda 1\s+T-001, T-003/);
  assert.match(listar.stdout, /reexecutar uma faixa/);

  const html = readFileSync(path.join(dir, 'plano-execucao.html'), 'utf-8');
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /codex exec/);
  assert.match(html, /Peça ao agente \(Codex\)/);
  assert.doesNotMatch(html, /claude -p/);

  const planoJson = JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8'));
  assert.equal(planoJson.agent, 'codex');
  assert.equal(planoJson.modo, 'paralelo');
  assert.equal(planoJson.faixas.length, 2);
});

test('plano (cursor): md + sh com o CLI do Cursor (bash válido) + html — sem claude -p nem codex exec', () => {
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  const { code, out } = cli('plano', 'pagamentos', '--agents', 'cursor');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(cursor\)/);
  assert.match(out, /executor headless/);
  // a lista de custos que o agente apresenta para confirmação
  assert.match(out, /modelos deste plano — CONFIRME com o usuário antes de executar/);
  assert.match(out, /--modelo composer/);
  // T-002 pedia claude-opus-5 — no cursor claude-* é slug válido: fica
  assert.match(out, /T-002 — claude-opus-5/);

  const md = readFileSync(path.join(dir, 'plano-execucao.md'), 'utf-8');
  assert.match(md, /Execução — Cursor headless \(agent CLI\)/);
  assert.doesNotMatch(md, /claude -p/);
  assert.doesNotMatch(md, /codex exec/);

  const shPath = path.join(dir, 'executar-tarefas.sh');
  assert.ok(statSync(shPath).mode & 0o100, 'script precisa ser executável');
  const bashN = spawnSync('bash', ['-n', shPath], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n falhou: ${bashN.stderr}`);
  const sh = readFileSync(shPath, 'utf-8');
  assert.match(sh, /CURSOR_BIN=\$\(command -v agent \|\| command -v cursor-agent\)/);
  assert.match(sh, /"\$CURSOR_BIN" -p "\$3" --model "\$4"/);
  assert.match(sh, /STREAM_FLAGS=\(--output-format stream-json\)/);
  assert.match(sh, /CURSOR_FLAGS=\(--force\)/);
  assert.match(sh, /rodar_tarefa 'faixa-2' 'T-002' '[\s\S]*?' 'claude-opus-5' high/);
  assert.doesNotMatch(sh, /claude -p/);
  assert.doesNotMatch(sh, /codex exec/);
  assert.doesNotMatch(sh, /--effort/, 'o CLI do Cursor não tem flag de esforço');
  assert.match(sh, /audit --ci/);

  // dispatcher igual ao do claude: reexecução por faixa disponível
  const listar = spawnSync('bash', [shPath, '--listar'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(listar.status, 0, listar.stderr);
  assert.match(listar.stdout, /faixa-1\s+onda 1\s+T-001, T-003/);
  assert.match(listar.stdout, /reexecutar uma faixa/);

  const html = readFileSync(path.join(dir, 'plano-execucao.html'), 'utf-8');
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /agent -p/);
  assert.match(html, /Peça ao agente \(Cursor\)/);
  assert.doesNotMatch(html, /claude -p/);

  const planoJson = JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8'));
  assert.equal(planoJson.agent, 'cursor');
  assert.equal(planoJson.modo, 'paralelo');
  assert.equal(planoJson.faixas.length, 2);

  // --esforco no cursor: o plano avisa que o CLI não tem a flag (o nível vai
  // no slug do modelo) — o valor fica registrado, mas ninguém é enganado
  const comEsforco = cli('plano', 'pagamentos', '--agents', 'cursor', '--esforco', 'baixo');
  assert.equal(comEsforco.code, 0, comEsforco.out);
  assert.match(comEsforco.out, /o CLI do Cursor não tem flag de esforço/);
});

test('tarefa atualiza o status no tasks.md (e valida entrada)', () => {
  const { code, out } = cli('tarefa', 'pagamentos', 'T-002', 'concluida');
  assert.equal(code, 0, out);
  const tasks = readFileSync(path.join(root, '.spec', 'features', 'pagamentos', 'tasks.md'), 'utf-8');
  assert.match(tasks, /## T-002 — Envio de recibo \[concluida\]/);

  assert.equal(cli('tarefa', 'pagamentos', 'T-099', 'concluida').code, 2);
  assert.equal(cli('tarefa', 'pagamentos', 'T-001', 'meio-feita').code, 2);
});

test('tarefa --modelo/--esforco: o usuário ajusta o custo por tarefa sem editar arquivo', () => {
  const tasksPath = path.join(root, '.spec', 'features', 'pagamentos', 'tasks.md');
  // insere os campos numa tarefa que não os tinha
  const r = cli('tarefa', 'pagamentos', 'T-001', '--modelo', 'gpt-5.6-luna', '--esforco', 'baixo');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Modelo: gpt-5\.6-luna/);
  assert.match(r.out, /regenere o plano/);
  const tasks = readFileSync(tasksPath, 'utf-8');
  const secaoT001 = tasks.slice(tasks.indexOf('## T-001'), tasks.indexOf('## T-002'));
  assert.match(secaoT001, /- Modelo: gpt-5\.6-luna/);
  assert.match(secaoT001, /- Esforço: baixo/);

  // substitui um campo que já existia (T-002 tinha Modelo: claude-opus-5)
  const r2 = cli('tarefa', 'pagamentos', 'T-002', '--modelo', 'gpt-5.6-terra');
  assert.equal(r2.code, 0, r2.out);
  const secaoT002 = readFileSync(tasksPath, 'utf-8').slice(
    readFileSync(tasksPath, 'utf-8').indexOf('## T-002'),
    readFileSync(tasksPath, 'utf-8').indexOf('## T-003')
  );
  assert.match(secaoT002, /- Modelo: gpt-5\.6-terra/);
  assert.doesNotMatch(secaoT002, /claude-opus-5/, 'o campo antigo foi substituído, não duplicado');

  // esforço inválido é barrado alto
  const r3 = cli('tarefa', 'pagamentos', 'T-001', '--esforco', 'turbo');
  assert.equal(r3.code, 2);
  assert.match(r3.out, /esforço inválido/);

  // o plano regenerado usa a escolha do usuário (e o parser leu o que gravamos)
  const p = cli('plano', 'pagamentos', '--agents', 'codex');
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /T-001 — gpt-5\.6-luna · esforço low/);
  const sh = readFileSync(path.join(root, '.spec', 'features', 'pagamentos', 'executar-tarefas.sh'), 'utf-8');
  assert.match(sh, /rodar_tarefa 'faixa-1' 'T-001' '[\s\S]*?' 'gpt-5.6-luna' low/);
});

test('plano (codex) imprime a lista de custos e --modelo/--esforco travam tudo', () => {
  // a lista que o agente apresenta ao usuário para confirmação
  const semTrava = cli('plano', 'pagamentos', '--agents', 'codex');
  assert.match(semTrava.out, /CONFIRME com o usuário antes de executar/);
  assert.match(semTrava.out, /quer gastar menos\?/);

  // o usuário travou: tudo luna/low, vencendo o que estiver no tasks.md
  const { code, out } = cli('plano', 'pagamentos', '--agents', 'codex', '--modelo', 'gpt-5.6-luna', '--esforco', 'baixo');
  assert.equal(code, 0, out);
  assert.match(out, /T-001 — gpt-5\.6-luna · esforço low/);
  assert.match(out, /T-003 — gpt-5\.6-luna · esforço low/);
  const planoJson = JSON.parse(
    readFileSync(path.join(root, '.spec', 'features', 'pagamentos', 'plano.json'), 'utf-8')
  );
  assert.equal(planoJson.modeloForcado, 'gpt-5.6-luna');
  assert.equal(planoJson.esforcoForcado, 'low');
  const md = readFileSync(path.join(root, '.spec', 'features', 'pagamentos', 'plano-execucao.md'), 'utf-8');
  assert.match(md, /custo travado pelo usuário/);

  // modelo do claude num plano do codex é erro, não troca silenciosa
  const errado = cli('plano', 'pagamentos', '--agents', 'codex', '--modelo', 'claude-opus-5');
  assert.equal(errado.code, 2);
  assert.match(errado.out, /é um modelo do Claude/);
});

test('upgrade: plano de versão anterior (sem runId) é registrado no ledger em vez de sumir', () => {
  const planoPath = path.join(root, '.spec', 'features', 'pagamentos', 'plano.json');
  // simula o artefato de uma versão que não tinha ledger
  const antigo = JSON.parse(readFileSync(planoPath, 'utf-8'));
  delete antigo.runId;
  writeFileSync(planoPath, JSON.stringify(antigo, null, 2));

  // regenerar o plano registra a execução no ledger global (fonte do resumo)
  const r = cli('plano', 'pagamentos');
  assert.equal(r.code, 0, r.out);
  const novo = JSON.parse(readFileSync(planoPath, 'utf-8'));
  assert.ok(novo.runId, 'plano regenerado ganha identificador de execução');

  // e o ledger passa a conhecer essa execução
  const ledger = readFileSync(path.join(homeOnp, 'painel', 'ledger.jsonl'), 'utf-8');
  assert.ok(ledger.includes(novo.runId), 'execução registrada no ledger global');
  assert.ok(ledger.includes('"tipo":"plano"'));
});

test('plano detecta o agente pelo que está instalado quando não há flag', () => {
  // este root tem .claude/skills E .agents/skills (codex) → claude tem precedência
  const { code, out } = cli('plano', 'pagamentos');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(claude\)/);
});

test('motor embarcado do codex detecta codex pelo PRÓPRIO marcador (mesmo com .claude no projeto)', () => {
  const embarcado = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  const proc = spawnSync('node', [embarcado, 'plano', 'pagamentos'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /plano de execução \(codex\)/);
});

test('sem .claude, a detecção usa o marcador da skill instalada em .agents (codex)', () => {
  rmSync(path.join(root, '.claude'), { recursive: true, force: true });
  const { code, out } = cli('plano', 'pagamentos');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(codex\)/);
});

test('motor embarcado do cursor detecta cursor pelo PRÓPRIO marcador (mesmo com .agents no projeto)', () => {
  const embarcado = path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  const proc = spawnSync('node', [embarcado, 'plano', 'pagamentos'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /plano de execução \(cursor\)/);
});

test('sem .claude e sem .agents, a detecção usa o marcador da skill instalada em .cursor', () => {
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const { code, out } = cli('plano', 'pagamentos');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(cursor\)/);
});

test('motor num checkout sob ~/.cursor/worktrees NÃO vira detecção de cursor (só .cursor/skills conta)', () => {
  // os agentes paralelos do Cursor fazem checkout de repositórios em
  // ~/.cursor/worktrees/<repo> — um motor rodando de lá NÃO é a skill do
  // cursor, e a detecção tem que respeitar o que está instalado no projeto
  assert.equal(cli('init', '--agents', 'claude').code, 0);
  const fake = path.join(root, 'fake-home', '.cursor', 'worktrees', 'onp-spec-driven');
  mkdirSync(fake, { recursive: true });
  const REPO_RAIZ = path.join(__dirname, '..');
  cpSync(path.join(REPO_RAIZ, 'src'), path.join(fake, 'src'), { recursive: true });
  cpSync(path.join(REPO_RAIZ, 'bin'), path.join(fake, 'bin'), { recursive: true });
  const proc = spawnSync('node', [path.join(fake, 'bin', 'onp-spec.js'), 'plano', 'pagamentos'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /plano de execução \(claude\)/, 'a skill do projeto (.claude) decide, não o caminho do motor');
});
