// E2E de PARIDADE com o claude e o codex, agora no Cursor: uma faixa falha, e
// dá para reexecutar SÓ ela. Usa um stub do CLI do Cursor (`agent`) que emite
// o stream-json de verdade do `agent -p --output-format stream-json` (mesmos
// tipos de evento da documentação oficial: system/init, tool_call
// started/completed com corpo em tool_call.<nome>ToolCall, assistant,
// result), então também prova que o stream chega ao ledger e que o
// `onp-spec resumo` teria o que narrar.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { lerEventos, montarArvore, lerStream, caminhos } from '../src/core/ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

let tmp;
let repo;
let stubDir;
const antes = process.env.ONP_SPEC_HOME;

// stub: emite os MESMOS tipos de evento do CLI do Cursor em modo headless
// (NDJSON), EXIGE as flags reais do executor (--output-format stream-json e
// --force — sem --force o print mode do Cursor não escreve), trabalha de
// verdade (arquivo + commit) e falha as tarefas listadas em ONP_STUB_FALHAR
const STUB = `#!/usr/bin/env bash
[ "\${1:-}" = "-p" ] || { echo "stub: esperava -p (modo print)" >&2; exit 2; }
PROMPT="\${2:-}"
case "$*" in *"--output-format stream-json"*) ;; *) echo "stub: esperava --output-format stream-json" >&2; exit 2 ;; esac
case "$*" in *"--force"*) ;; *) echo "stub: esperava --force (sem ele o print não escreve)" >&2; exit 2 ;; esac
TAREFA=$(printf '%s' "$PROMPT" | grep -o 'T-[0-9]\\{3\\}' | head -1)
[ -z "$TAREFA" ] && TAREFA="T-000"
printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"apiKeySource\\":\\"login\\",\\"cwd\\":\\"$PWD\\",\\"session_id\\":\\"sessao-$TAREFA\\",\\"model\\":\\"stub\\",\\"permissionMode\\":\\"default\\"}"
printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"started\\",\\"call_id\\":\\"c1\\",\\"tool_call\\":{\\"readToolCall\\":{\\"args\\":{\\"path\\":\\"spec.md\\"}}}}"
printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"completed\\",\\"call_id\\":\\"c1\\",\\"tool_call\\":{\\"readToolCall\\":{\\"args\\":{\\"path\\":\\"spec.md\\"},\\"result\\":{\\"success\\":{\\"content\\":\\"conteudo\\",\\"totalLines\\":10}}}}}"
if printf '%s' "\${ONP_STUB_FALHAR:-}" | grep -q "$TAREFA"; then
  printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"completed\\",\\"call_id\\":\\"c2\\",\\"tool_call\\":{\\"shellToolCall\\":{\\"args\\":{\\"command\\":\\"node --test\\"},\\"result\\":{\\"error\\":{\\"message\\":\\"teste vermelho\\"}}}}}"
  printf '%s\\n' "{\\"type\\":\\"result\\",\\"subtype\\":\\"error\\",\\"duration_ms\\":10,\\"is_error\\":true,\\"result\\":\\"teste vermelho\\",\\"session_id\\":\\"sessao-$TAREFA\\"}"
  exit 1
fi
printf 'feito por %s\\n' "$TAREFA" > "arquivo-$TAREFA.txt"
printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"completed\\",\\"call_id\\":\\"c3\\",\\"tool_call\\":{\\"writeToolCall\\":{\\"args\\":{\\"path\\":\\"arquivo-$TAREFA.txt\\"},\\"result\\":{\\"success\\":{\\"linesCreated\\":1}}}}}"
git add -A >/dev/null 2>&1
git commit -q -m "$TAREFA: feito pelo stub" >/dev/null 2>&1
printf '%s\\n' "{\\"type\\":\\"assistant\\",\\"message\\":{\\"role\\":\\"assistant\\",\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"feito por $TAREFA\\"}]},\\"session_id\\":\\"sessao-$TAREFA\\"}"
printf '%s\\n' "{\\"type\\":\\"result\\",\\"subtype\\":\\"success\\",\\"duration_ms\\":42,\\"duration_api_ms\\":40,\\"is_error\\":false,\\"result\\":\\"feito por $TAREFA\\",\\"session_id\\":\\"sessao-$TAREFA\\"}"
exit 0
`;

const SPEC = `# Spec: Pagamentos

> feature: pagamentos
> status: em-implementacao

## Histórias

### US-001 — Cobrança

Como financeiro, quero cobrar, para receber.

#### AC-001 — Cobrança criada

- **Dado** um aluno ativo
- **Quando** o mês vira
- **Então** a cobrança aparece

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
`;

const TASKS = `# Tasks: Pagamentos

> feature: pagamentos

## T-001 — Modelo [pendente]

- Refs: AC-001
- Arquivos: src/a.js

## T-002 — Serviço [pendente]

- Refs: AC-001
- Arquivos: src/b.js
`;

function cli(args, extraEnv = {}) {
  return spawnSync('node', [BIN, ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, ...extraEnv },
  });
}

function rodarScript(args, extraEnv = {}) {
  return spawnSync('bash', [path.join(repo, '.spec/features/pagamentos/executar-tarefas.sh'), ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, ...extraEnv },
  });
}

const execucao = () => montarArvore(lerEventos())[0].execucoes[0];
const commits = () =>
  parseInt(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).stdout.trim(), 10);

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-reexec-cursor-'));
  process.env.ONP_SPEC_HOME = path.join(tmp, 'home');
  stubDir = path.join(tmp, 'stub');
  mkdirSync(stubDir, { recursive: true });
  // o executor procura `agent` primeiro (nome atual) — o stub responde por ele
  writeFileSync(path.join(stubDir, 'agent'), STUB);
  chmodSync(path.join(stubDir, 'agent'), 0o755);

  repo = path.join(tmp, 'projeto');
  mkdirSync(repo, { recursive: true });
  for (const args of [['init', '-q'], ['config', 'user.email', 't@t.dev'], ['config', 'user.name', 'T']]) {
    spawnSync('git', args, { cwd: repo });
  }
  cli(['init']);
  cli(['new', 'pagamentos']);
  writeFileSync(path.join(repo, '.spec/features/pagamentos/spec.md'), SPEC);
  writeFileSync(path.join(repo, '.spec/features/pagamentos/tasks.md'), TASKS);
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-qm', 'spec'], { cwd: repo });
});

after(() => {
  if (antes === undefined) delete process.env.ONP_SPEC_HOME;
  else process.env.ONP_SPEC_HOME = antes;
  spawnSync('git', ['worktree', 'prune'], { cwd: repo });
  rmSync(tmp, { recursive: true, force: true });
  rmSync(path.join(path.dirname(tmp), 'onp-worktrees'), { recursive: true, force: true });
});

test('plano --agents cursor registra a execução no ledger global (com projeto e faixas)', () => {
  const r = cli(['plano', 'pagamentos', '--agents', 'cursor']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(caminhos().ledger.startsWith(path.join(tmp, 'home')), 'ledger isolado no tmp do teste');
  const ex = execucao();
  assert.equal(ex.feature, 'pagamentos');
  assert.equal(ex.agent, 'cursor');
  assert.equal(ex.faixas.length, 2, 'T-001 e T-002 têm arquivos disjuntos → 2 faixas paralelas');
  assert.equal(ex.total, 2);
  assert.equal(ex.fim, null);
});

test('execução completa via CLI do Cursor: faixa-2 falha, faixa-1 conclui e o stream fica gravado', () => {
  const r = rodarScript([], { ONP_STUB_FALHAR: 'T-002' });
  assert.equal(r.status, 1, 'exit 1 porque houve falha e o audit não fecha');

  const ex = execucao();
  assert.equal(ex.faixas.find((f) => f.id === 'faixa-1').estado, 'mesclada');
  assert.equal(ex.faixas.find((f) => f.id === 'faixa-2').estado, 'falhou');
  assert.equal(ex.faixas.find((f) => f.id === 'faixa-1').tarefas[0].estado, 'concluida');
  assert.equal(ex.faixas.find((f) => f.id === 'faixa-2').tarefas[0].estado, 'falhou');
  assert.equal(ex.fim, 1);
  assert.equal(ex.gate.audit, 1, 'o gate rodou e reprovou (sem testes escritos)');

  // o tasks.md só marcou a tarefa que realmente passou
  const tasks = readFileSync(path.join(repo, '.spec/features/pagamentos/tasks.md'), 'utf-8');
  assert.match(tasks, /## T-001 — Modelo \[concluida\]/);
  assert.match(tasks, /## T-002 — Serviço \[pendente\]/);

  // stream do modelo (stream-json do Cursor): dá para ver o que aconteceu
  const ok = lerStream(ex.runId, 'faixa-1--T-001');
  assert.equal(ok.existe, true);
  assert.equal(ok.resumo.status, 'sucesso');
  assert.deepEqual(
    ok.itens.filter((i) => i.tipo === 'ferramenta').map((i) => i.nome),
    ['Read', 'Write'],
    'tool_calls do Cursor viram ferramentas na linha do tempo'
  );
  assert.ok(ok.itens.some((i) => i.tipo === 'texto' && /feito por T-001/.test(i.texto)));

  const falha = lerStream(ex.runId, 'faixa-2--T-002');
  assert.equal(falha.resumo.status, 'erro');
  assert.ok(
    falha.itens.some((i) => i.tipo === 'saida' && i.erro),
    'o tool_call com result de erro aparece como erro no stream'
  );

  // o trap de saída gravou o resumo final no ledger (nunca silêncio)
  assert.ok(lerEventos().some((e) => e.tipo === 'resumo' && e.runId === ex.runId));
  // e `onp-spec resumo` narra o estado com o que está no ledger
  const resumo = cli(['resumo', 'pagamentos']);
  assert.equal(resumo.status, 0, resumo.stderr);
  assert.match(resumo.stdout, /faixa-2 falhou — peça ao agente/);
});

test('reexecutar SÓ a faixa que falhou: nova tentativa, sem tocar na faixa que já passou', () => {
  const antesCommits = commits();
  const arquivoDaFaixa1 = path.join(repo, 'arquivo-T-001.txt');
  const conteudoAntes = readFileSync(arquivoDaFaixa1, 'utf-8');

  const r = rodarScript(['--faixa', 'faixa-2']); // sem ONP_STUB_FALHAR: agora passa
  assert.equal(r.status, 1, 'ainda exit 1: o audit reprova por falta de testes — e isso é honesto');

  const ex = execucao();
  const f2 = ex.faixas.find((f) => f.id === 'faixa-2');
  assert.equal(f2.estado, 'mesclada');
  assert.equal(f2.tentativa, 2, 'a reexecução conta como tentativa 2');
  assert.equal(f2.tarefas[0].estado, 'concluida');
  // a faixa que já estava pronta não foi reexecutada
  assert.equal(ex.faixas.find((f) => f.id === 'faixa-1').tentativa, 1);
  assert.equal(readFileSync(arquivoDaFaixa1, 'utf-8'), conteudoAntes, 'trabalho da faixa-1 intacto');
  assert.equal(ex.escopoUltimo, 'faixa:faixa-2');
  assert.equal(ex.concluidas, 2);

  const tasks = readFileSync(path.join(repo, '.spec/features/pagamentos/tasks.md'), 'utf-8');
  assert.match(tasks, /## T-002 — Serviço \[concluida\]/);
  assert.ok(commits() > antesCommits, 'a reexecução commitou por cima do que já existia');

  // o stream da tarefa reexecutada foi substituído pelo da nova tentativa
  assert.equal(lerStream(ex.runId, 'faixa-2--T-002').resumo.status, 'sucesso');
});

test('--sem-gate não inventa veredito: registra pendência e manda rodar o gate', () => {
  const r = rodarScript(['--faixa', 'faixa-2', '--sem-gate']);
  assert.equal(r.status, 0, 'o trabalho terminou bem');
  assert.match(r.stdout, /SEM o gate/);
  assert.match(r.stdout, /NÃO é prova de nada/);
  assert.doesNotMatch(r.stdout, /audit exit 0/, 'nunca anunciar alinhamento sem rodar o audit');
  const ex = execucao();
  assert.equal(ex.fim, 1, 'sem veredito, a execução não fica "concluída"');
  assert.equal(ex.gateDesatualizado, true, 'o resumo avisa que o gate está velho');
});

test('--gate roda só o gate e devolve o veredito fresco', () => {
  const r = rodarScript(['--gate']);
  assert.match(r.stdout, /gate: verify \+ audit --ci/);
  const ex = execucao();
  assert.equal(ex.gateDesatualizado, false);
  assert.equal(ex.gate.audit, 1);
  assert.equal(ex.escopoUltimo, 'gate');
});

test('faixa inexistente falha alto em vez de rodar coisa errada', () => {
  const r = rodarScript(['--faixa', 'faixa-99']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /faixa desconhecida/);
});

test('argumento desconhecido não é ignorado em silêncio', () => {
  const r = rodarScript(['--apaga-tudo']);
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /argumento desconhecido/);
});

test('--listar não precisa de ambiente pronto e mostra os alvos', () => {
  const r = rodarScript(['--listar']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /faixa-1\s+onda 1\s+T-001/);
  assert.match(r.stdout, /faixa-2\s+onda 1\s+T-002/);
});

test('sem o CLI do Cursor no PATH, o preparo falha ALTO com a instrução de instalação', () => {
  // PATH sem o stub (mas com node e git): nem `agent` nem `cursor-agent`
  // existem → mensagem clara com o comando de instalação
  const pathSemStub = `${path.dirname(process.execPath)}:/usr/bin:/bin`;
  const semCli = spawnSync(
    'bash',
    [path.join(repo, '.spec/features/pagamentos/executar-tarefas.sh'), '--gate'],
    {
      cwd: repo,
      encoding: 'utf-8',
      env: { ...process.env, PATH: pathSemStub },
    }
  );
  assert.equal(semCli.status, 1);
  assert.match(semCli.stdout + semCli.stderr, /CLI do Cursor \(agent\) não encontrado/);
  assert.match(semCli.stdout + semCli.stderr, /curl https:\/\/cursor\.com\/install/);
});

test('só com o binário LEGADO cursor-agent no PATH, o fallback resolve e o script segue', () => {
  // máquina antiga: existe cursor-agent, não existe agent — o CURSOR_BIN cai
  // no fallback e o preparo passa (a faixa pedida não existe de propósito:
  // o erro esperado é "faixa desconhecida", NUNCA "CLI não encontrado")
  const legadoDir = path.join(tmp, 'stub-legado');
  mkdirSync(legadoDir, { recursive: true });
  writeFileSync(path.join(legadoDir, 'cursor-agent'), STUB);
  chmodSync(path.join(legadoDir, 'cursor-agent'), 0o755);
  const r = spawnSync(
    'bash',
    [path.join(repo, '.spec/features/pagamentos/executar-tarefas.sh'), '--faixa', 'faixa-99'],
    {
      cwd: repo,
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${legadoDir}:${path.dirname(process.execPath)}:/usr/bin:/bin` },
    }
  );
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout + r.stderr, /CLI do Cursor \(agent\) não encontrado/);
  assert.match(r.stdout + r.stderr, /faixa desconhecida/);
});

test('worktrees das faixas mescladas foram removidos ao final', () => {
  const lista = spawnSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf-8' }).stdout;
  assert.equal(lista.trim().split('\n').length, 1, `sobrou worktree:\n${lista}`);
  assert.ok(!existsSync(path.join(path.dirname(repo), 'onp-worktrees', 'projeto-pagamentos-faixa-2')));
});
