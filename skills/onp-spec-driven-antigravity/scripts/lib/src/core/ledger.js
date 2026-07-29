// Ledger global — UM arquivo para todas as execuções, de todos os projetos.
//
//   ~/.onp-spec/painel/ledger.jsonl        (override: ONP_SPEC_HOME)
//   ~/.onp-spec/painel/streams/<runId>/<chave>.jsonl
//
// Cada linha do ledger é um evento JSON. O painel lê esse arquivo único e
// monta a árvore projeto → execução → faixa → tarefa, então funciona mesmo
// com projetos diferentes rodando ao mesmo tempo (é a fonte de verdade
// compartilhada; o repositório do usuário não guarda estado de execução).
//
// Tipos de evento:
//   plano  {runId, projeto, projetoDir, feature, agent, plano}
//   faixa  {runId, faixa, estado: executando|mesclando|mesclada|conflito|falhou, tentativa}
//   tarefa {runId, tarefa, faixa, estado: executando|concluida|falhou, stream}
//   gate   {runId, etapa: verify|audit, exit}
//   fim    {runId, exit, escopo}
//
// O stream de cada tarefa é o NDJSON cru do `claude -p --output-format
// stream-json` — o parser abaixo transforma em linha do tempo legível.

import os from 'os';
import path from 'path';
import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from 'fs';

export const ESTADOS_FAIXA = ['aguardando', 'executando', 'mesclando', 'mesclada', 'conflito', 'falhou'];
export const MAX_EXECUCOES = 30; // poda: execuções mais antigas somem (com seus streams)

export function homeOnp() {
  return process.env.ONP_SPEC_HOME || path.join(os.homedir(), '.onp-spec');
}

export function caminhos() {
  const dir = path.join(homeOnp(), 'painel');
  return { dir, ledger: path.join(dir, 'ledger.jsonl'), streams: path.join(dir, 'streams') };
}

export function registrarEvento(evento) {
  const { dir, ledger } = caminhos();
  mkdirSync(dir, { recursive: true });
  const linha = JSON.stringify({ ts: new Date().toISOString(), ...evento });
  appendFileSync(ledger, `${linha}\n`);
  return linha;
}

export function lerEventos() {
  const { ledger } = caminhos();
  if (!existsSync(ledger)) return [];
  const out = [];
  for (const linha of readFileSync(ledger, 'utf-8').split('\n')) {
    if (!linha.trim()) continue;
    try {
      out.push(JSON.parse(linha));
    } catch {
      // linha corrompida (disco cheio, escrita concorrente truncada) — ignora
    }
  }
  return out;
}

export function caminhoStream(runId, chave) {
  return path.join(caminhos().streams, runId, `${chave}.jsonl`);
}

export function chaveStream(faixaOuSeq, tarefa) {
  return `${faixaOuSeq}--${tarefa}`;
}

// ── árvore consolidada (o que o painel desenha) ─────────────────────────────

export function montarArvore(eventos, { projetoDir = null, feature = null } = {}) {
  const execucoes = new Map();

  for (const e of eventos) {
    if (e.tipo === 'plano') {
      const p = e.plano || {};
      execucoes.set(e.runId, {
        runId: e.runId,
        projeto: e.projeto,
        projetoDir: e.projetoDir,
        feature: e.feature,
        agent: e.agent,
        criadoEm: e.ts,
        atualizadoEm: e.ts,
        branchTrabalho: p.branchTrabalho,
        baseDir: p.baseDir,
        ondas: p.ondas || [],
        faixas: (p.faixas || []).map((fx) => ({
          id: fx.id,
          branch: fx.branch,
          worktree: fx.worktree,
          estado: 'aguardando',
          tentativa: 0,
          tarefas: (fx.tarefas || []).map((t) => ({ ...t, estado: 'pendente', stream: null })),
        })),
        sequenciais: (p.sequenciais || []).map((t) => ({ ...t, estado: 'pendente', stream: null })),
        gate: { verify: null, audit: null },
        gateDesatualizado: false,
        fim: null,
        escopoUltimo: null,
      });
      continue;
    }
    const ex = execucoes.get(e.runId);
    if (!ex) continue; // evento de execução cujo plano foi podado
    ex.atualizadoEm = e.ts;

    if (e.tipo === 'faixa') {
      const fx = ex.faixas.find((f) => f.id === e.faixa);
      if (fx) {
        fx.estado = e.estado;
        if (e.tentativa) fx.tentativa = e.tentativa;
        // nova tentativa reabre as tarefas da faixa
        if (e.estado === 'executando') {
          for (const t of fx.tarefas) if (t.estado !== 'concluida') t.estado = 'pendente';
        }
      }
    } else if (e.tipo === 'tarefa') {
      const todas = [...ex.faixas.flatMap((f) => f.tarefas), ...ex.sequenciais];
      const t = todas.find((x) => x.id === e.tarefa);
      if (t) {
        t.estado = e.estado;
        if (e.stream) t.stream = e.stream;
      }
    } else if (e.tipo === 'gate') {
      if (e.etapa === 'inicio') ex.gate = { verify: null, audit: null };
      if (e.etapa === 'verify' || e.etapa === 'audit') ex.gate[e.etapa] = e.exit;
      // audit novo = veredito fresco
      if (e.etapa === 'audit') ex.gateDesatualizado = false;
    } else if (e.tipo === 'fim') {
      ex.fim = e.exit;
      ex.escopoUltimo = e.escopo || 'tudo';
    } else if (e.tipo === 'inicio') {
      ex.fim = null;
      ex.escopoUltimo = e.escopo || 'tudo';
      // qualquer trabalho novo invalida o veredito anterior até o audit rodar
      ex.gateDesatualizado = ex.gate.audit !== null;
      if (!e.escopo || e.escopo === 'tudo') {
        ex.gate = { verify: null, audit: null };
        ex.gateDesatualizado = false;
      }
    }
  }

  let lista = [...execucoes.values()];
  if (projetoDir) lista = lista.filter((ex) => path.resolve(ex.projetoDir || '') === path.resolve(projetoDir));
  if (feature) lista = lista.filter((ex) => ex.feature === feature);

  // uma execução está "rodando" se alguma faixa/tarefa está em curso
  for (const ex of lista) {
    const emCurso =
      ex.faixas.some((f) => f.estado === 'executando' || f.estado === 'mesclando') ||
      [...ex.faixas.flatMap((f) => f.tarefas), ...ex.sequenciais].some((t) => t.estado === 'executando');
    ex.rodando = emCurso && ex.fim === null;
    const tarefas = [...ex.faixas.flatMap((f) => f.tarefas), ...ex.sequenciais];
    ex.total = tarefas.length;
    ex.concluidas = tarefas.filter((t) => t.estado === 'concluida').length;
    ex.falhas = ex.faixas.filter((f) => f.estado === 'falhou' || f.estado === 'conflito').length;
  }

  // projetos, mais recentes primeiro
  const projetos = new Map();
  for (const ex of lista.sort((a, b) => (a.atualizadoEm < b.atualizadoEm ? 1 : -1))) {
    const chave = ex.projetoDir || ex.projeto;
    if (!projetos.has(chave)) {
      projetos.set(chave, { projeto: ex.projeto, projetoDir: ex.projetoDir, execucoes: [] });
    }
    projetos.get(chave).execucoes.push(ex);
  }
  return [...projetos.values()];
}

// ── poda: o ledger é único e append-only; não pode crescer para sempre ──────

export function podarLedger(maxExecucoes = MAX_EXECUCOES) {
  const { ledger, streams } = caminhos();
  if (!existsSync(ledger)) return { removidas: [] };
  const eventos = lerEventos();
  const ordem = [];
  for (const e of eventos) if (e.tipo === 'plano' && !ordem.includes(e.runId)) ordem.push(e.runId);
  if (ordem.length <= maxExecucoes) return { removidas: [] };

  const remover = new Set(ordem.slice(0, ordem.length - maxExecucoes));
  const mantidos = eventos.filter((e) => !remover.has(e.runId));
  writeFileSync(ledger, mantidos.map((e) => JSON.stringify(e)).join('\n') + (mantidos.length ? '\n' : ''));
  for (const runId of remover) rmSync(path.join(streams, runId), { recursive: true, force: true });
  return { removidas: [...remover] };
}

// ── parser do stream do modelo (NDJSON do claude -p) ───────────────────────

const CORTE = 400;
const corta = (s, n = CORTE) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// resumo de uma linha por ferramenta: o que importa ver ao vivo
export function resumoFerramenta(nome, input = {}) {
  const rel = (p) => String(p || '').split('/').slice(-3).join('/');
  switch (nome) {
    case 'Bash':
      return corta(input.command, 200);
    case 'Read':
      return rel(input.file_path);
    case 'Write':
      return `${rel(input.file_path)} (${String(input.content || '').split('\n').length} linhas)`;
    case 'Edit':
      return `${rel(input.file_path)} — ${corta(String(input.old_string || '').split('\n')[0], 60)}`;
    case 'Glob':
    case 'Grep':
      return corta(input.pattern, 120);
    case 'TodoWrite':
      return `${(input.todos || []).length} item(ns)`;
    case 'Task':
      return corta(input.description, 120);
    case 'WebFetch':
    case 'WebSearch':
      return corta(input.url || input.query, 120);
    default: {
      const chaves = Object.keys(input);
      if (!chaves.length) return '';
      return corta(`${chaves[0]}: ${JSON.stringify(input[chaves[0]])}`, 160);
    }
  }
}

function textoDeConteudo(conteudo) {
  if (typeof conteudo === 'string') return conteudo;
  if (Array.isArray(conteudo)) {
    return conteudo
      .map((c) => (typeof c === 'string' ? c : c && c.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// Transforma o NDJSON cru numa linha do tempo. `desde` = linhas já lidas
// (o painel pede incremental); devolve também o total para o próximo pedido.
export function resumirStream(texto, { desde = 0 } = {}) {
  const linhas = String(texto || '').split('\n').filter((l) => l.trim());
  const novas = linhas.slice(desde);
  const itens = [];
  let resumo = null;
  let pensando = null;

  for (const linha of novas) {
    let e;
    try {
      e = JSON.parse(linha);
    } catch {
      itens.push({ tipo: 'cru', texto: corta(linha, 300) });
      continue;
    }
    if (e.type === 'system' && e.subtype === 'init') {
      itens.push({ tipo: 'inicio', modelo: e.model, sessao: String(e.session_id || '').slice(0, 8) });
    } else if (e.type === 'system' && e.subtype === 'thinking_tokens') {
      // agrega: um item de "pensando" que cresce, em vez de dezenas de linhas
      if (pensando) pensando.tokens = e.estimated_tokens;
      else {
        pensando = { tipo: 'pensando', tokens: e.estimated_tokens, texto: '' };
        itens.push(pensando);
      }
    } else if (e.type === 'assistant' && e.message) {
      for (const c of e.message.content || []) {
        if (c.type === 'tool_use') {
          pensando = null;
          itens.push({
            tipo: 'ferramenta',
            nome: c.name,
            resumo: resumoFerramenta(c.name, c.input || {}),
            detalhe: corta(JSON.stringify(c.input || {}, null, 2), 1200),
          });
        } else if (c.type === 'thinking') {
          const t = String(c.thinking || '');
          if (t.trim()) {
            // texto disponível (nem sempre: em headless costuma vir redigido)
            if (pensando) pensando.texto = corta(t, 1200);
            else itens.push({ tipo: 'pensando', tokens: null, texto: corta(t, 1200) });
          }
        } else if (c.type === 'text' && String(c.text || '').trim()) {
          pensando = null;
          itens.push({ tipo: 'texto', texto: corta(c.text, 1200) });
        }
      }
    } else if (e.type === 'user' && e.message) {
      for (const c of e.message.content || []) {
        if (c.type === 'tool_result') {
          pensando = null;
          itens.push({
            tipo: 'saida',
            erro: Boolean(c.is_error),
            texto: corta(textoDeConteudo(c.content), 600),
          });
        }
      }
    } else if (e.type === 'result') {
      pensando = null;
      resumo = {
        status: e.is_error ? 'erro' : e.subtype === 'success' ? 'sucesso' : String(e.subtype || ''),
        duracaoMs: e.duration_ms ?? null,
        turnos: e.num_turns ?? null,
        custoUsd: e.total_cost_usd ?? null,
        tokensSaida: e.usage?.output_tokens ?? null,
        tokensEntrada: e.usage?.input_tokens ?? null,
      };
      itens.push({ tipo: 'fim', ...resumo, texto: corta(e.result, 600) });
    }
  }

  return { itens, total: linhas.length, resumo };
}

export function lerStream(runId, chave, { desde = 0 } = {}) {
  const caminho = caminhoStream(runId, chave);
  if (!existsSync(caminho)) return { itens: [], total: 0, resumo: null, existe: false };
  return { ...resumirStream(readFileSync(caminho, 'utf-8'), { desde }), existe: true };
}

// streams gravados de uma execução (para o painel listar mesmo sem evento)
export function streamsDaExecucao(runId) {
  const dir = path.join(caminhos().streams, runId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ chave: f.replace(/\.jsonl$/, ''), mtime: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}
