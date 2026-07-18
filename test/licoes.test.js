import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  carregarSinais,
  salvarSinais,
  registrarAchados,
  registrarVerify,
  buscarSinal,
} from '../src/core/sinais.js';
import {
  carregarLicoes,
  salvarLicoes,
  adicionarLicao,
  listarLicoes,
  penalizarLicao,
  podarLicoes,
  sugerirLicoes,
  LICOES_DEFAULTS,
} from '../src/core/licoes.js';

// A tese da camada: o agente fraseia, o motor decide o que É lição —
// lastro obrigatório, promoção por recorrência, poda, quarentena.

const roots = [];
function specRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-licoes-'));
  roots.push(root);
  const spec = path.join(root, '.spec');
  mkdirSync(path.join(spec, 'verification'), { recursive: true });
  return spec;
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function achado(code, feature, ref, extra = {}) {
  return { code, severity: 'erro', message: `${ref} sem prova`, feature, ...extra };
}

// ---------- lastro (o gate mecânico) ----------

test('lição sem nenhum sinal registrado é recusada (LICAO_SEM_LASTRO)', () => {
  const spec = specRoot();
  const data = carregarLicoes(spec);
  const r = adicionarLicao(data, carregarSinais(spec), {
    texto: 'Asserte o valor persistido do status, não só a existência do campo',
    sinal: 'AC_SEM_PROVA',
    feature: 'pagamentos',
    fonte: 'AC-042',
  });
  assert.match(r.erro, /LICAO_SEM_LASTRO/);
  assert.equal(data.licoes.length, 0);
});

test('sinal registrado pelo audit dá lastro e a lição nasce candidata', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const data = carregarLicoes(spec);
  const r = adicionarLicao(data, carregarSinais(spec), {
    texto: 'Asserte o valor persistido do status, não só a existência do campo',
    sinal: 'AC_SEM_PROVA',
    feature: 'pagamentos',
    fonte: 'AC-042',
  });
  assert.equal(r.evento, 'criada');
  assert.equal(r.licao.status, 'candidata');
  assert.equal(r.licao.id, 'L-001');
  assert.equal(r.licao.recorrencia, 1);
});

test('fonte que não corresponde ao ref registrado é recusada, com dica das refs válidas', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const r = adicionarLicao(carregarLicoes(spec), carregarSinais(spec), {
    texto: 'Qualquer regra',
    sinal: 'AC_SEM_PROVA',
    feature: 'pagamentos',
    fonte: 'AC-999',
  });
  assert.match(r.erro, /LICAO_SEM_LASTRO/);
  assert.match(r.erro, /AC-042/);
});

test('sinal de outra feature não dá lastro', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const r = adicionarLicao(carregarLicoes(spec), carregarSinais(spec), {
    texto: 'Qualquer regra',
    sinal: 'AC_SEM_PROVA',
    feature: 'cobranca',
    fonte: 'AC-042',
  });
  assert.match(r.erro, /LICAO_SEM_LASTRO/);
});

test('sinal global (sem feature, ex.: TESTE_ORFAO) dá lastro a qualquer feature', () => {
  const spec = specRoot();
  registrarAchados(spec, [
    { code: 'TESTE_ORFAO', severity: 'erro', message: 'teste @spec:AC-777 órfão', file: 'test/x.test.js' },
  ]);
  const r = adicionarLicao(carregarLicoes(spec), carregarSinais(spec), {
    texto: 'Ao renomear um AC, atualize as tags @spec dos testes no mesmo commit',
    sinal: 'TESTE_ORFAO',
    feature: 'pagamentos',
    fonte: 'AC-777',
  });
  assert.equal(r.evento, 'criada');
});

test('fonte pode ser o arquivo registrado ou conter o ref (match parcial)', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const r = adicionarLicao(carregarLicoes(spec), carregarSinais(spec), {
    texto: 'Outra regra',
    sinal: 'AC_SEM_PROVA',
    feature: 'pagamentos',
    fonte: 'AC-042 (test/pagamentos.test.js:12)',
  });
  assert.equal(r.evento, 'criada');
});

test('texto longo demais é recusado — lição é UMA frase', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const r = adicionarLicao(carregarLicoes(spec), carregarSinais(spec), {
    texto: 'x'.repeat(300),
    sinal: 'AC_SEM_PROVA',
    feature: 'pagamentos',
    fonte: 'AC-042',
  });
  assert.match(r.erro, /280/);
});

test('flag sem valor (true booleano) não quebra: campo vira ausente', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const data = carregarLicoes(spec);
  const sinais = carregarSinais(spec);

  const semTexto = adicionarLicao(data, sinais, {
    texto: true, sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042',
  });
  assert.match(semTexto.erro, /--texto/);

  const escopoSolto = adicionarLicao(data, sinais, {
    texto: 'Regra válida', sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042', escopo: true,
  });
  assert.equal(escopoSolto.evento, 'criada');
  assert.equal(escopoSolto.licao.escopo, null);
});

// ---------- dedup e promoção ----------

test('mesma lição refraseada (caixa/acentos/pontuação) na mesma feature deduplica sem promover', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const data = carregarLicoes(spec);
  const sinais = carregarSinais(spec);
  const base = {
    sinal: 'AC_SEM_PROVA',
    feature: 'pagamentos',
    fonte: 'AC-042',
  };
  adicionarLicao(data, sinais, { ...base, texto: 'Asserte o valor persistido, não a existência do campo' });
  const r = adicionarLicao(data, sinais, { ...base, texto: 'ASSERTE o valor persistido — não a existência do campo!!' });
  assert.equal(r.evento, 'reforcada');
  assert.equal(data.licoes.length, 1);
  assert.equal(r.licao.recorrencia, 1);
  assert.equal(r.licao.status, 'candidata');
});

test('recorrência em 2ª feature distinta promove candidata a confirmada', () => {
  const spec = specRoot();
  registrarAchados(spec, [
    achado('AC_SEM_PROVA', 'pagamentos', 'AC-042'),
    achado('AC_SEM_PROVA', 'cobranca', 'AC-051'),
  ]);
  const data = carregarLicoes(spec);
  const sinais = carregarSinais(spec);
  const texto = 'Asserte o valor persistido do status, não só a existência do campo';
  adicionarLicao(data, sinais, { texto, sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042' });
  const r = adicionarLicao(data, sinais, { texto, sinal: 'AC_SEM_PROVA', feature: 'cobranca', fonte: 'AC-051' });
  assert.equal(r.evento, 'promovida');
  assert.equal(r.licao.status, 'confirmada');
  assert.deepEqual(r.licao.features, ['pagamentos', 'cobranca']);
});

test('mesmo texto com sinal diferente é outra lição (chave inclui o sinal)', () => {
  const spec = specRoot();
  registrarAchados(spec, [
    achado('AC_SEM_PROVA', 'pagamentos', 'AC-042'),
    achado('AC_SEM_TESTE', 'pagamentos', 'AC-043'),
  ]);
  const data = carregarLicoes(spec);
  const sinais = carregarSinais(spec);
  const texto = 'Regra idêntica de fraseado';
  adicionarLicao(data, sinais, { texto, sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042' });
  adicionarLicao(data, sinais, { texto, sinal: 'AC_SEM_TESTE', feature: 'pagamentos', fonte: 'AC-043' });
  assert.equal(data.licoes.length, 2);
});

// ---------- listagem (o guia carregado no Especificar) ----------

test('list: default só confirmadas, ordenadas por recorrência, com teto', () => {
  const data = { schema: 1, proximoId: 4, licoes: [] };
  const t = new Date().toISOString();
  const licao = (id, status, recorrencia, escopo = null) => ({
    id, texto: `regra ${id}`, chave: `S::regra ${id}`, sinal: 'AC_SEM_PROVA', escopo,
    status, recorrencia, features: ['a'], evidencias: [], penalidades: 0, criadaEm: t, ultimaVez: t,
  });
  data.licoes.push(licao('L-001', 'candidata', 1));
  data.licoes.push(licao('L-002', 'confirmada', 3));
  data.licoes.push(licao('L-003', 'confirmada', 5));
  data.licoes.push(licao('L-004', 'quarentena', 4));

  const padrao = listarLicoes(data);
  assert.deepEqual(padrao.map((l) => l.id), ['L-003', 'L-002']);

  assert.equal(listarLicoes(data, { limite: 1 }).length, 1);
  assert.equal(listarLicoes(data, { status: 'todas' }).length, 4);
});

test('list: filtro de escopo casa por prefixo hierárquico e query é normalizada', () => {
  const t = new Date().toISOString();
  const data = {
    schema: 1,
    proximoId: 3,
    licoes: [
      {
        id: 'L-001', texto: 'Valide idempotência de webhook antes de gravar', chave: 'a', sinal: 'AC_SEM_PROVA',
        escopo: 'cobranca/boleto', status: 'confirmada', recorrencia: 2, features: ['a', 'b'],
        evidencias: [], penalidades: 0, criadaEm: t, ultimaVez: t,
      },
      {
        id: 'L-002', texto: 'Outra regra', chave: 'b', sinal: 'AC_SEM_PROVA',
        escopo: 'pix', status: 'confirmada', recorrencia: 2, features: ['a', 'b'],
        evidencias: [], penalidades: 0, criadaEm: t, ultimaVez: t,
      },
    ],
  };
  assert.deepEqual(listarLicoes(data, { escopo: 'cobranca' }).map((l) => l.id), ['L-001']);
  assert.deepEqual(listarLicoes(data, { escopo: 'cobranca/boleto' }).map((l) => l.id), ['L-001']);
  assert.equal(listarLicoes(data, { escopo: 'cob' }).length, 0);
  assert.deepEqual(listarLicoes(data, { query: 'IDEMPOTÊNCIA' }).map((l) => l.id), ['L-001']);
});

// ---------- penalização e quarentena ----------

test('2 penalidades movem confirmada para quarentena; re-registro é recusado', () => {
  const spec = specRoot();
  registrarAchados(spec, [
    achado('AC_SEM_PROVA', 'pagamentos', 'AC-042'),
    achado('AC_SEM_PROVA', 'cobranca', 'AC-051'),
  ]);
  const data = carregarLicoes(spec);
  const sinais = carregarSinais(spec);
  const texto = 'Regra que não funcionou na prática';
  adicionarLicao(data, sinais, { texto, sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042' });
  adicionarLicao(data, sinais, { texto, sinal: 'AC_SEM_PROVA', feature: 'cobranca', fonte: 'AC-051' });

  assert.equal(penalizarLicao(data, 'L-001').evento, 'penalizada');
  const r = penalizarLicao(data, 'L-001');
  assert.equal(r.evento, 'quarentenada');
  assert.equal(r.licao.status, 'quarentena');
  assert.equal(listarLicoes(data).length, 0);

  const readd = adicionarLicao(data, sinais, { texto, sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042' });
  assert.match(readd.erro, /quarentena/);
});

test('penalizar candidata ou lição inexistente é erro', () => {
  const t = new Date().toISOString();
  const data = {
    schema: 1, proximoId: 2,
    licoes: [{
      id: 'L-001', texto: 'x', chave: 'k', sinal: 'S', escopo: null, status: 'candidata',
      recorrencia: 1, features: ['a'], evidencias: [], penalidades: 0, criadaEm: t, ultimaVez: t,
    }],
  };
  assert.match(penalizarLicao(data, 'L-001').erro, /candidata/);
  assert.match(penalizarLicao(data, 'L-999').erro, /não existe/);
});

// ---------- poda ----------

test('poda remove candidata estagnada fora da janela; confirmada e recente ficam', () => {
  const velha = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const recente = new Date().toISOString();
  const licao = (id, status, ultimaVez) => ({
    id, texto: id, chave: id, sinal: 'S', escopo: null, status, recorrencia: status === 'confirmada' ? 2 : 1,
    features: ['a'], evidencias: [], penalidades: 0, criadaEm: velha, ultimaVez,
  });
  const data = {
    schema: 1, proximoId: 4,
    licoes: [licao('L-001', 'candidata', velha), licao('L-002', 'candidata', recente), licao('L-003', 'confirmada', velha)],
  };
  const removidas = podarLicoes(data, LICOES_DEFAULTS);
  assert.deepEqual(removidas, ['L-001']);
  assert.deepEqual(data.licoes.map((l) => l.id), ['L-002', 'L-003']);
});

// ---------- sugerir (mineração mecânica) ----------

test('sugerir aponta sinais recorrentes em features distintas e conta lições existentes', () => {
  const spec = specRoot();
  registrarAchados(spec, [
    achado('AC_SEM_PROVA', 'pagamentos', 'AC-042'),
    achado('AC_SEM_PROVA', 'cobranca', 'AC-051'),
    achado('AC_SEM_PROVA', 'assinaturas', 'AC-063'),
    achado('Q_ABERTA', 'pagamentos', 'Q-001'),
  ]);
  const data = carregarLicoes(spec);
  const sinais = carregarSinais(spec);

  let sugestoes = sugerirLicoes(data, sinais);
  assert.equal(sugestoes.length, 1);
  assert.equal(sugestoes[0].sinal, 'AC_SEM_PROVA');
  assert.equal(sugestoes[0].features.length, 3);
  assert.equal(sugestoes[0].licoesExistentes, 0);

  adicionarLicao(data, sinais, {
    texto: 'Rode verify antes de marcar task concluída',
    sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042',
  });
  sugestoes = sugerirLicoes(data, sinais);
  assert.equal(sugestoes[0].licoesExistentes, 1);
});

// ---------- histórico de sinais ----------

test('registrarVerify grava VERIFY_FALHOU/VERIFY_PULADO por AC e princípio; pass não gera sinal', () => {
  const spec = specRoot();
  const n = registrarVerify(spec, {
    feature: 'pagamentos',
    gitRev: 'abc1234',
    results: {
      'AC-001': { status: 'fail' },
      'AC-002': { status: 'skip' },
      'AC-003': { status: 'pass' },
    },
    principles: { 'P-001': { status: 'fail', testName: 'p' } },
  });
  assert.equal(n, 3);
  const sinais = carregarSinais(spec);
  const codigos = Object.values(sinais.sinais).map((s) => `${s.codigo}:${s.ref}`).sort();
  assert.deepEqual(codigos, ['VERIFY_FALHOU:AC-001', 'VERIFY_FALHOU:P-001', 'VERIFY_PULADO:AC-002']);
});

test('sinal repetido acumula ocorrências na mesma chave em vez de duplicar', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_TESTE', 'pagamentos', 'AC-042')]);
  registrarAchados(spec, [achado('AC_SEM_TESTE', 'pagamentos', 'AC-042')]);
  const sinais = carregarSinais(spec);
  const entradas = Object.values(sinais.sinais);
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].ocorrencias, 2);
});

test('compactação: fora da janela cai, e o teto mantém só os mais recentes', () => {
  const spec = specRoot();
  const data = { schema: 1, sinais: {} };
  const velho = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  data.sinais['VELHO::f::AC-001'] = {
    codigo: 'VELHO', feature: 'f', ref: 'AC-001', ocorrencias: 1, primeiraVez: velho, ultimaVez: velho, gitRev: null,
  };
  for (let i = 0; i < 10; i++) {
    const t = new Date(Date.now() - i * 1000).toISOString();
    data.sinais[`S::f::AC-${100 + i}`] = {
      codigo: 'S', feature: 'f', ref: `AC-${100 + i}`, ocorrencias: 1, primeiraVez: t, ultimaVez: t, gitRev: null,
    };
  }
  salvarSinais(spec, data, { janelaDias: 90, maxSinais: 5 });
  const salvo = carregarSinais(spec);
  const refs = Object.values(salvo.sinais).map((s) => s.ref).sort();
  assert.deepEqual(refs, ['AC-100', 'AC-101', 'AC-102', 'AC-103', 'AC-104']);
});

test('buscarSinal exige fonte e não aceita fonte curta em match parcial', () => {
  const data = {
    schema: 1,
    sinais: {
      'S::f::AC-042': { codigo: 'S', feature: 'f', ref: 'AC-042', ocorrencias: 1, primeiraVez: 'x', ultimaVez: 'x', gitRev: null },
    },
  };
  assert.equal(buscarSinal(data, { sinal: 'S', feature: 'f', fonte: '' }), null);
  assert.equal(buscarSinal(data, { sinal: 'S', feature: 'f', fonte: 'AC' }), null);
  assert.ok(buscarSinal(data, { sinal: 'S', feature: 'f', fonte: 'AC-042' }));
});

// ---------- render ----------

test('salvarLicoes gera licoes.json + LICOES.md com as três seções', () => {
  const spec = specRoot();
  registrarAchados(spec, [achado('AC_SEM_PROVA', 'pagamentos', 'AC-042')]);
  const data = carregarLicoes(spec);
  adicionarLicao(data, carregarSinais(spec), {
    texto: 'Asserte o valor persistido', sinal: 'AC_SEM_PROVA', feature: 'pagamentos', fonte: 'AC-042', escopo: 'cobranca',
  });
  salvarLicoes(spec, data);

  assert.ok(existsSync(path.join(spec, 'licoes.json')));
  const md = readFileSync(path.join(spec, 'LICOES.md'), 'utf-8');
  assert.match(md, /## Confirmadas/);
  assert.match(md, /## Candidatas/);
  assert.match(md, /## Quarentena/);
  assert.match(md, /L-001 — Asserte o valor persistido/);
  assert.match(md, /escopo: `cobranca`/);

  const relido = carregarLicoes(spec);
  assert.equal(relido.licoes.length, 1);
  assert.equal(relido.proximoId, 2);
});

// ---------- fluxo real via CLI (init → audit → licoes) ----------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

function specDe(feature, us, ac) {
  return `# Spec: ${feature}

> feature: ${feature}
> status: em-implementacao

## Histórias

### ${us} — História de ${feature}

Como usuário, quero ${feature}, para que funcione.

#### ${ac} — Critério de ${feature}

- **Dado** um estado inicial
- **Quando** a ação acontece
- **Então** o resultado é observável

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
`;
}

test('CLI ponta-a-ponta: audit registra sinais, add exige lastro, recorrência promove', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-licoes-e2e-'));
  roots.push(root);
  const cli = (...args) => {
    const proc = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf-8' });
    return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
  };

  assert.equal(cli('init').code, 0);
  for (const [feature, us, ac] of [
    ['pagamentos', 'US-101', 'AC-101'],
    ['cobranca', 'US-201', 'AC-201'],
  ]) {
    mkdirSync(path.join(root, '.spec', 'features', feature), { recursive: true });
    writeFileSync(path.join(root, '.spec', 'features', feature, 'spec.md'), specDe(feature, us, ac));
  }

  const audit = cli('audit');
  assert.equal(audit.code, 1);
  assert.match(audit.out, /sinal\(is\) registrados no histórico/);
  assert.ok(existsSync(path.join(root, '.spec', 'verification', 'sinais.json')));

  const semLastro = cli(
    'licoes', 'add',
    '--sinal', 'AC_SEM_TESTE', '--feature', 'pagamentos', '--fonte', 'AC-999',
    '--texto', 'Todo AC nasce com teste via scaffold antes de implementar'
  );
  assert.equal(semLastro.code, 2);
  assert.match(semLastro.out, /LICAO_SEM_LASTRO/);

  const texto = 'Todo AC nasce com teste via scaffold antes de implementar';
  const add1 = cli('licoes', 'add', '--sinal', 'AC_SEM_TESTE', '--feature', 'pagamentos', '--fonte', 'AC-101', '--texto', texto, '--escopo', 'cobranca');
  assert.equal(add1.code, 0, add1.out);
  assert.match(add1.out, /candidata/);

  const listVazia = cli('licoes', 'list');
  assert.match(listVazia.out, /nenhuma lição confirmada/);

  const add2 = cli('licoes', 'add', '--sinal', 'AC_SEM_TESTE', '--feature', 'cobranca', '--fonte', 'AC-201', '--texto', texto);
  assert.equal(add2.code, 0, add2.out);
  assert.match(add2.out, /PROMOVIDA/);

  const list = cli('licoes', 'list');
  assert.match(list.out, /L-001 \[confirmada\]/);
  assert.match(list.out, /2 feature\(s\)/);

  const sugerir = cli('licoes', 'sugerir');
  assert.equal(sugerir.code, 0);
  assert.match(sugerir.out, /AC_SEM_TESTE/);

  const status = cli('licoes', 'status');
  assert.match(status.out, /1 confirmada\(s\)/);
  assert.match(status.out, /ponto\(s\) de falha distintos/);
});
