// Resumo geral de andamento — o texto que o agente posta no chat e o
// executor imprime no terminal a cada ~1 minuto durante a execução.
//
// Duas origens, sempre rotuladas:
//   'ia'    — escrito por um modelo (o executor headless chama `claude -p`,
//             `codex exec` ou o CLI do Cursor `agent -p`; no Antigravity é
//             o próprio agente que escreve) e gravado com
//             `onp-spec resumo <feature> --gravar --texto "..."`
//   'motor' — determinístico, montado da árvore do ledger. É o fallback
//             sempre disponível: zero dependências, zero rede, zero modelo.
//
// Regra de frescor: só vale um resumo de IA com menos de 2 minutos; passado
// disso (ou sem resumo gravado), vale o do motor — um resumo velho afirmando
// "executando" seria mentira.

import { openSync, closeSync, readSync, statSync, existsSync } from 'fs';
import {
  registrarEvento,
  caminhoStream,
  resumoFerramenta,
  resumoItemCodex,
  resumoToolCallCursor,
} from './ledger.js';

export const FRESCOR_IA_MS = 2 * 60 * 1000;

// ── última ação de uma tarefa (tail barato do stream NDJSON) ───────────────

export function ultimaAcao(runId, chave, { maxBytes = 4096 } = {}) {
  const caminho = caminhoStream(runId, chave);
  if (!existsSync(caminho)) return null;
  let texto;
  let cortado = false;
  try {
    const st = statSync(caminho);
    const fd = openSync(caminho, 'r');
    const inicio = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(Math.min(maxBytes, st.size));
    readSync(fd, buf, 0, buf.length, inicio);
    closeSync(fd);
    texto = buf.toString('utf-8');
    cortado = inicio > 0;
  } catch {
    return null;
  }
  const linhas = texto.split('\n').filter((l) => l.trim());
  if (cortado && linhas.length) linhas.shift(); // primeira linha pode vir truncada
  for (let i = linhas.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(linhas[i]);
    } catch {
      continue;
    }
    if (e.type === 'assistant' && e.message) {
      for (const c of [...(e.message.content || [])].reverse()) {
        if (c.type === 'tool_use') return `${c.name}: ${resumoFerramenta(c.name, c.input || {})}`;
        if (c.type === 'text' && String(c.text || '').trim()) {
          const t = String(c.text).trim().split('\n')[0];
          return t.length > 120 ? `${t.slice(0, 120)}…` : t;
        }
      }
    }
    // codex exec --json: item.started mostra o comando ainda em execução
    if ((e.type === 'item.completed' || e.type === 'item.started') && e.item) {
      const fer = resumoItemCodex(e.item);
      if (fer) return fer.resumo ? `${fer.nome}: ${fer.resumo}` : fer.nome;
      if (e.item.type === 'agent_message' && String(e.item.text || '').trim()) {
        const t = String(e.item.text).trim().split('\n')[0];
        return t.length > 120 ? `${t.slice(0, 120)}…` : t;
      }
    }
    // CLI do Cursor: tool_call started mostra a ferramenta ainda em execução
    if (e.type === 'tool_call' && e.tool_call) {
      const fer = resumoToolCallCursor(e.tool_call);
      if (fer) return fer.resumo ? `${fer.nome}: ${fer.resumo}` : fer.nome;
    }
  }
  return null;
}

// ── resumo determinístico (o motor conta o que vê no ledger) ───────────────

function fraseExecucao(ex) {
  const frases = [];
  const rotulo = `"${ex.feature}" (${ex.projeto})`;
  frases.push(`${rotulo}: ${ex.concluidas} de ${ex.total} tarefa(s) concluída(s).`);

  const executando = [];
  for (const fx of ex.faixas) {
    for (const t of fx.tarefas) {
      if (t.estado === 'executando') executando.push({ faixa: fx.id, t });
    }
  }
  for (const t of ex.sequenciais) {
    if (t.estado === 'executando') executando.push({ faixa: 'seq', t });
  }
  for (const { faixa, t } of executando) {
    const acao = t.stream ? ultimaAcao(ex.runId, t.stream) : null;
    frases.push(
      `Executando agora: ${t.id} (${t.titulo}) na ${faixa}${acao ? ` — última ação: ${acao}` : ''}.`
    );
  }

  const falhas = ex.faixas.filter((f) => f.estado === 'falhou' || f.estado === 'conflito');
  for (const fx of falhas) {
    frases.push(
      fx.estado === 'conflito'
        ? `A ${fx.id} parou em CONFLITO de merge — precisa de resolução pelo agente ou por você.`
        : `A ${fx.id} falhou — peça ao agente para reexecutá-la (--faixa ${fx.id}).`
    );
  }

  if (!ex.rodando) {
    if (ex.fim === 0 && ex.gate.audit === 0 && !ex.gateDesatualizado) {
      frases.push('Concluída: especificação e código alinhados (audit exit 0).');
    } else if (ex.fim === 1) {
      frases.push('Terminou com pendências — veja o gate e as faixas acima.');
    } else if (ex.concluidas === ex.total && ex.total > 0 && ex.gate.audit == null) {
      frases.push('Tarefas prontas, gate (verify + audit) ainda pendente.');
    } else if (!executando.length) {
      frases.push('Parada no momento — nenhuma tarefa em execução.');
    }
  }
  return frases;
}

export function resumoDeterministico(projetos) {
  const execucoes = projetos.flatMap((p) => p.execucoes);
  if (!execucoes.length) {
    return 'Nenhuma execução no ledger ainda. Gere um plano com `onp-spec plano <feature>` e peça ao agente para executar.';
  }
  // relevância: tudo que roda; se nada roda, a execução mais recente
  const rodando = execucoes.filter((ex) => ex.rodando);
  const alvo = rodando.length ? rodando : [execucoes[0]];
  return alvo.flatMap(fraseExecucao).join(' ');
}

// contexto mais rico para o modelo narrador (o `claude -p` do executor):
// o resumo do motor + as últimas ações por tarefa em execução
export function contextoParaIa(projetos) {
  const L = [`Estado mecânico: ${resumoDeterministico(projetos)}`];
  for (const p of projetos) {
    for (const ex of p.execucoes) {
      if (!ex.rodando) continue;
      for (const fx of ex.faixas) {
        L.push(`- ${ex.feature}/${fx.id}: ${fx.estado}${fx.tentativa > 1 ? ` (tentativa ${fx.tentativa})` : ''}`);
        for (const t of fx.tarefas) {
          const acao = t.stream ? ultimaAcao(ex.runId, t.stream) : null;
          L.push(`  - ${t.id} [${t.estado}] ${t.titulo}${acao ? ` · última ação: ${acao}` : ''}`);
        }
      }
      for (const t of ex.sequenciais) L.push(`  - seq ${t.id} [${t.estado}] ${t.titulo}`);
    }
  }
  return L.join('\n');
}

// ── tabela de andamento (markdown, pronta para o chat) ─────────────────────
//
// O agente posta ESTA tabela no chat a cada ~1 minuto enquanto a execução
// roda: uma linha por tarefa, com onde ela roda (faixa/seq), o estado agora
// e a última ação vista no stream. Célula é texto de UMA linha (pipes e
// quebras são higienizados para não quebrar a tabela).

const ICONE_ESTADO = {
  pendente: '⏳',
  executando: '▶️',
  concluida: '✅',
  falhou: '❌',
};

const celula = (s) =>
  String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim() || '—';

function tabelaExecucao(ex) {
  const L = [];
  const modo = ex.faixas.length ? `${ex.faixas.length} faixa(s) paralela(s)` : 'sequencial';
  L.push(
    `**${ex.feature}** (${ex.projeto}) — ${ex.concluidas} de ${ex.total} tarefa(s) concluída(s) · ${modo}` +
      (ex.rodando ? ' · EM EXECUÇÃO' : '')
  );
  L.push('');
  L.push('| tarefa | título | onde | status | última ação |');
  L.push('|---|---|---|---|---|');
  const linha = (t, onde) => {
    const icone = ICONE_ESTADO[t.estado] || '·';
    const acao = t.estado === 'executando' && t.stream ? ultimaAcao(ex.runId, t.stream) : null;
    L.push(`| ${t.id} | ${celula(t.titulo)} | ${onde} | ${icone} ${t.estado} | ${celula(acao)} |`);
  };
  for (const fx of ex.faixas) for (const t of fx.tarefas) linha(t, fx.id);
  for (const t of ex.sequenciais) linha(t, 'seq');

  const rodape = [];
  for (const fx of ex.faixas) {
    if (fx.estado === 'conflito') rodape.push(`${fx.id} em CONFLITO de merge`);
    else if (fx.estado === 'falhou') rodape.push(`${fx.id} falhou (reexecute: --faixa ${fx.id})`);
  }
  if (ex.gate.verify != null) rodape.push(`verify exit ${ex.gate.verify}`);
  if (ex.gate.audit != null) rodape.push(`audit exit ${ex.gate.audit}${ex.gateDesatualizado ? ' (desatualizado)' : ''}`);
  if (rodape.length) {
    L.push('');
    L.push(rodape.join(' · '));
  }
  return L.join('\n');
}

export function tabelaAndamento(projetos) {
  const execucoes = projetos.flatMap((p) => p.execucoes);
  if (!execucoes.length) {
    return 'Nenhuma execução no ledger ainda. Gere um plano com `onp-spec plano <feature>` e peça ao agente para executar.';
  }
  // mesma relevância do resumo: tudo que roda; se nada roda, a mais recente
  const rodando = execucoes.filter((ex) => ex.rodando);
  const alvo = rodando.length ? rodando : [execucoes[0]];
  return alvo.map(tabelaExecucao).join('\n\n');
}

// ── o resumo que vale AGORA (IA fresca > motor) ────────────────────────────

export function montarResumoAtual(projetos, { agora = Date.now() } = {}) {
  let ultimo = null;
  for (const p of projetos) {
    for (const ex of p.execucoes) {
      if (ex.resumo && (!ultimo || ex.resumo.ts > ultimo.ts)) ultimo = ex.resumo;
    }
  }
  if (ultimo && ultimo.origem === 'ia' && agora - new Date(ultimo.ts).getTime() < FRESCOR_IA_MS) {
    return ultimo;
  }
  return { texto: resumoDeterministico(projetos), origem: 'motor', ts: new Date(agora).toISOString() };
}

// ── gravação (usada pelo executor e pelos agentes) ─────────────────────────

const MAX_TEXTO = 1200;

export function registrarResumo({ runId, texto, origem = 'motor' }) {
  const limpo = String(texto || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXTO);
  if (!runId || !limpo) return { erro: 'resumo precisa de runId e texto' };
  registrarEvento({ tipo: 'resumo', runId, texto: limpo, origem: origem === 'ia' ? 'ia' : 'motor' });
  return { texto: limpo, origem };
}

// execução alvo para `--gravar` sem --run: a mais recente rodando no escopo
export function execucaoAlvo(projetos, { runId = null } = {}) {
  const execucoes = projetos.flatMap((p) => p.execucoes);
  if (runId) return execucoes.find((ex) => ex.runId === runId) || null;
  return execucoes.find((ex) => ex.rodando) || execucoes[0] || null;
}
