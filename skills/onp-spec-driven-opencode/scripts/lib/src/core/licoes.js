// Camada de lições — o projeto aprende com os próprios sinais.
//
// A divisão que mantém isso vivo: o agente entra com o JULGAMENTO (frasear a
// regra geral que evitaria a recorrência); o motor é dono de tudo MECÂNICO —
// lastro contra o histórico de sinais, dedup por normalização, recorrência
// por feature distinta, promoção candidata→confirmada, penalização→
// quarentena, poda e renderização. Contabilidade manual é exatamente o que
// apodrece um arquivo de lições, então ela não existe aqui.
//
// Seletividade é mecânica, não opinião:
//   1. lição sem sinal registrado no histórico → recusada (LICAO_SEM_LASTRO);
//   2. só lições corroboradas em >= limiarPromocao features distintas viram
//      confirmadas — e só confirmadas são carregadas como guia;
//   3. candidatas não corroboradas dentro da janela são podadas;
//   4. a listagem tem teto fixo — o custo de contexto não cresce com o repo.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { buscarSinal, refsDisponiveis, SINAIS_DEFAULTS } from './sinais.js';

export const LICOES_DEFAULTS = {
  limiarPromocao: 2,
  limiarQuarentena: 2,
  janelaDias: SINAIS_DEFAULTS.janelaDias,
  limiteListagem: 10,
  maxSinais: SINAIS_DEFAULTS.maxSinais,
};

export const LICAO_STATUSES = ['candidata', 'confirmada', 'quarentena'];

const MAX_TEXTO = 280;
const MAX_EVIDENCIAS = 5;

function agora() {
  return new Date().toISOString();
}

function caminhoStore(specRoot) {
  return path.join(specRoot, 'licoes.json');
}

function caminhoRender(specRoot) {
  return path.join(specRoot, 'LICOES.md');
}

export function carregarLicoes(specRoot) {
  const file = caminhoStore(specRoot);
  if (!existsSync(file)) return { schema: 1, proximoId: 1, licoes: [] };
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(data.licoes)) data.licoes = [];
    if (!Number.isInteger(data.proximoId)) data.proximoId = data.licoes.length + 1;
    return data;
  } catch {
    throw new Error(`${file} corrompido — restaure do git ou apague para recomeçar`);
  }
}

export function salvarLicoes(specRoot, data) {
  mkdirSync(specRoot, { recursive: true });
  writeFileSync(caminhoStore(specRoot), `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(caminhoRender(specRoot), renderLicoes(data));
}

// Chave de dedup: minúsculas, sem acentos, sem pontuação, espaços colapsados.
// Exata-após-normalização, sem semântica — por isso o fraseado precisa ser
// canônico e terso (duas lições que dizem o mesmo têm que LER igual).
function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

// Flags de CLI sem valor chegam como `true` — trate qualquer não-string
// como ausente em vez de quebrar.
function campo(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

export function adicionarLicao(data, sinaisData, entrada, cfg = LICOES_DEFAULTS) {
  const texto = campo(entrada.texto);
  const sinal = campo(entrada.sinal);
  const feature = campo(entrada.feature);
  const fonte = campo(entrada.fonte);
  const escopo = campo(entrada.escopo) || null;

  if (!texto) return { erro: 'faltou --texto: a regra geral, em uma frase acionável' };
  if (texto.length > MAX_TEXTO) {
    return {
      erro: `texto com ${texto.length} caracteres — uma lição é UMA frase geral e acionável (máx ${MAX_TEXTO})`,
    };
  }
  if (!sinal) return { erro: 'faltou --sinal: o código do achado/falha que motivou a lição' };
  if (!feature) return { erro: 'faltou --feature: a feature em que o sinal aconteceu' };
  if (!fonte) return { erro: 'faltou --fonte: o ID (AC-xxx, T-xxx, P-xxx...) ou arquivo do sinal' };

  const lastro = buscarSinal(sinaisData, { sinal, feature, fonte });
  if (!lastro) {
    const refs = refsDisponiveis(sinaisData, { sinal, feature });
    const dica = refs.length
      ? `refs registradas para ${sinal} em ${feature}: ${refs.slice(0, 8).join(', ')}${refs.length > 8 ? ` (+${refs.length - 8})` : ''}`
      : `nenhum sinal ${sinal} registrado para ${feature} — o histórico só é escrito por audit/verify`;
    return {
      erro: `LICAO_SEM_LASTRO: nenhum sinal corresponde a (${sinal}, ${feature}, ${fonte}). Lição sem sinal real é opinião — o motor recusa. ${dica}`,
    };
  }

  const evidencia = {
    fonte: lastro.ref,
    feature,
    quando: agora(),
    gitRev: lastro.gitRev || null,
  };

  const chave = `${sinal}::${normalizar(texto)}`;
  const existente = data.licoes.find((l) => l.chave === chave);

  if (existente) {
    if (existente.status === 'quarentena') {
      return {
        erro: `${existente.id} está em quarentena (foi aplicada e a falha recorreu) — revise com o usuário antes de reativar`,
      };
    }
    if (!existente.features.includes(feature)) existente.features.push(feature);
    existente.recorrencia = existente.features.length;
    existente.evidencias = [...existente.evidencias, evidencia].slice(-MAX_EVIDENCIAS);
    existente.ultimaVez = evidencia.quando;
    if (escopo && !existente.escopo) existente.escopo = escopo;
    if (existente.status === 'candidata' && existente.recorrencia >= cfg.limiarPromocao) {
      existente.status = 'confirmada';
      return { licao: existente, evento: 'promovida' };
    }
    return { licao: existente, evento: 'reforcada' };
  }

  const licao = {
    id: `L-${pad3(data.proximoId)}`,
    texto,
    chave,
    sinal,
    escopo,
    status: 'candidata',
    recorrencia: 1,
    features: [feature],
    evidencias: [evidencia],
    penalidades: 0,
    criadaEm: evidencia.quando,
    ultimaVez: evidencia.quando,
  };
  data.proximoId += 1;
  data.licoes.push(licao);
  return { licao, evento: 'criada' };
}

// Poda: candidata que não corroborou dentro da janela sai do store.
export function podarLicoes(data, cfg = LICOES_DEFAULTS) {
  const corte = Date.now() - cfg.janelaDias * 24 * 60 * 60 * 1000;
  const removidas = [];
  data.licoes = data.licoes.filter((l) => {
    const estagnada =
      l.status === 'candidata' &&
      l.recorrencia < cfg.limiarPromocao &&
      Date.parse(l.ultimaVez) < corte;
    if (estagnada) removidas.push(l.id);
    return !estagnada;
  });
  return removidas;
}

function escopoCasa(escopoLicao, filtro) {
  if (!filtro) return true;
  if (!escopoLicao) return false;
  return escopoLicao === filtro || escopoLicao.startsWith(`${filtro}/`);
}

export function listarLicoes(data, opts = {}) {
  const status = opts.status || 'confirmada';
  const limite = opts.limite ?? LICOES_DEFAULTS.limiteListagem;
  const query = opts.query ? normalizar(opts.query) : null;

  return data.licoes
    .filter((l) => status === 'todas' || l.status === status)
    .filter((l) => escopoCasa(l.escopo, opts.escopo))
    .filter(
      (l) =>
        !query ||
        normalizar(`${l.texto} ${l.sinal} ${l.escopo || ''}`).includes(query)
    )
    .sort(
      (a, b) =>
        b.recorrencia - a.recorrencia || Date.parse(b.ultimaVez) - Date.parse(a.ultimaVez)
    )
    .slice(0, limite);
}

export function penalizarLicao(data, id, cfg = LICOES_DEFAULTS) {
  const licao = data.licoes.find((l) => l.id === id);
  if (!licao) return { erro: `lição ${id} não existe` };
  if (licao.status !== 'confirmada') {
    return {
      erro: `${id} está "${licao.status}" — só lições confirmadas são aplicadas como guia, logo só elas podem falhar ao ser aplicadas`,
    };
  }
  licao.penalidades += 1;
  if (licao.penalidades >= cfg.limiarQuarentena) {
    licao.status = 'quarentena';
    return { licao, evento: 'quarentenada' };
  }
  return { licao, evento: 'penalizada' };
}

// Mineração mecânica: sinais que recorreram em features distintas e ainda têm
// pouca (ou nenhuma) lição associada. O motor aponta ONDE vale escrever uma
// lição; o julgamento de COMO fraseá-la continua sendo do agente.
export function sugerirLicoes(data, sinaisData, cfg = LICOES_DEFAULTS, opts = {}) {
  const limite = opts.limite ?? 5;
  const porCodigo = new Map();
  for (const s of Object.values(sinaisData.sinais)) {
    let g = porCodigo.get(s.codigo);
    if (!g) {
      g = { codigo: s.codigo, features: new Set(), refs: new Set(), ocorrencias: 0 };
      porCodigo.set(s.codigo, g);
    }
    if (s.feature !== '—') g.features.add(s.feature);
    if (s.ref !== '—') g.refs.add(s.ref);
    g.ocorrencias += s.ocorrencias;
  }

  return [...porCodigo.values()]
    .filter((g) => g.features.size >= cfg.limiarPromocao)
    .map((g) => ({
      sinal: g.codigo,
      features: [...g.features].sort(),
      refs: [...g.refs].slice(0, 8),
      ocorrencias: g.ocorrencias,
      licoesExistentes: data.licoes.filter(
        (l) => l.sinal === g.codigo && l.status !== 'quarentena'
      ).length,
    }))
    .sort(
      (a, b) =>
        a.licoesExistentes - b.licoesExistentes ||
        b.features.length - a.features.length ||
        b.ocorrencias - a.ocorrencias
    )
    .slice(0, limite);
}

export function renderLicoes(data) {
  const linhas = [];
  linhas.push('# LIÇÕES — mantido pelo motor (`onp-spec licoes`)');
  linhas.push('');
  linhas.push('> Não edite à mão: qualquer escrita do motor sobrescreve este arquivo.');
  linhas.push('> Estado canônico em `.spec/licoes.json`; mutação só via `onp-spec licoes`.');
  linhas.push('');

  const porStatus = { confirmada: [], candidata: [], quarentena: [] };
  for (const l of data.licoes) (porStatus[l.status] || porStatus.candidata).push(l);

  const bloco = (titulo, itens, nota) => {
    linhas.push(`## ${titulo}`);
    linhas.push('');
    linhas.push(nota);
    linhas.push('');
    if (!itens.length) {
      linhas.push('_nenhuma_');
      linhas.push('');
      return;
    }
    for (const l of [...itens].sort((a, b) => a.id.localeCompare(b.id))) {
      linhas.push(`### ${l.id} — ${l.texto}`);
      const escopo = l.escopo ? ` · escopo: \`${l.escopo}\`` : '';
      linhas.push(
        `- sinal: \`${l.sinal}\` · recorrência: ${l.recorrencia} feature(s)${escopo} · penalidades: ${l.penalidades}`
      );
      linhas.push(`- features: ${l.features.join(', ')}`);
      const ev = l.evidencias[l.evidencias.length - 1];
      if (ev) linhas.push(`- última evidência: ${ev.fonte} (${ev.feature}, ${ev.quando})`);
      linhas.push('');
    }
  };

  bloco(
    'Confirmadas — carregue no Especificar/Projetar',
    porStatus.confirmada,
    'Corroboradas em múltiplas features. Aplique como guia.'
  );
  bloco(
    'Candidatas — em observação, NÃO aplicar ainda',
    porStatus.candidata,
    'Vistas em uma feature só. Registradas, não confiadas.'
  );
  bloco(
    'Quarentena — aplicadas e falharam, ignorar',
    porStatus.quarentena,
    'A falha recorreu mesmo com a lição aplicada. Revisão é do usuário.'
  );

  return `${linhas.join('\n').trimEnd()}\n`;
}
