// Histórico de sinais — a memória mecânica do motor.
//
// Cada achado do audit e cada falha/skip do verify vira um sinal persistido
// em .spec/verification/sinais.json. É esse histórico que dá LASTRO às
// lições: `licoes add` só aceita uma lição se o sinal citado realmente
// aconteceu neste projeto. Sem sinal registrado, lição é opinião — recusada.
//
// O arquivo é chaveado por (codigo, feature, ref), não append-only: o tamanho
// cresce com o número de PONTOS DE FALHA distintos, não com o número de
// execuções — o que o mantém limitado mesmo com centenas de features.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

export const SINAIS_DEFAULTS = { janelaDias: 90, maxSinais: 20000 };

const RE_REF = /(?:US|AC|ASM|Q|T|P)-\d{3,}/;

function agora() {
  return new Date().toISOString();
}

function caminhoSinais(specRoot) {
  return path.join(specRoot, 'verification', 'sinais.json');
}

export function carregarSinais(specRoot) {
  const file = caminhoSinais(specRoot);
  if (!existsSync(file)) return { schema: 1, sinais: {} };
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (!data.sinais || typeof data.sinais !== 'object') data.sinais = {};
    return data;
  } catch {
    return { schema: 1, sinais: {} };
  }
}

// Mantém o histórico limitado: descarta sinais fora da janela e, se ainda
// exceder o teto, fica com os mais recentes.
function compactar(data, opts) {
  const janelaDias = opts.janelaDias ?? SINAIS_DEFAULTS.janelaDias;
  const max = opts.maxSinais ?? SINAIS_DEFAULTS.maxSinais;
  const corte = Date.now() - janelaDias * 24 * 60 * 60 * 1000;
  let entradas = Object.entries(data.sinais).filter(
    ([, s]) => Date.parse(s.ultimaVez) >= corte
  );
  if (entradas.length > max) {
    entradas.sort((a, b) => Date.parse(b[1].ultimaVez) - Date.parse(a[1].ultimaVez));
    entradas = entradas.slice(0, max);
  }
  data.sinais = Object.fromEntries(entradas);
}

export function salvarSinais(specRoot, data, opts = {}) {
  compactar(data, opts);
  const file = caminhoSinais(specRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function registrar(data, { codigo, feature, ref, gitRev }) {
  const chave = `${codigo}::${feature || '—'}::${ref || '—'}`;
  const existente = data.sinais[chave];
  if (existente) {
    existente.ocorrencias += 1;
    existente.ultimaVez = agora();
    if (gitRev) existente.gitRev = gitRev;
  } else {
    data.sinais[chave] = {
      codigo,
      feature: feature || '—',
      ref: ref || '—',
      ocorrencias: 1,
      primeiraVez: agora(),
      ultimaVez: agora(),
      gitRev: gitRev || null,
    };
  }
}

// Ref conferível de um achado: o ID canônico citado (campo explícito ou o
// primeiro da mensagem); senão o arquivo apontado.
function refDoAchado(f) {
  if (f.principle) return f.principle;
  const m = (f.message || '').match(RE_REF);
  if (m) return m[0];
  return f.file || '—';
}

export function registrarAchados(specRoot, findings, { gitRev = null, ...opts } = {}) {
  if (!findings.length || !existsSync(specRoot)) return 0;
  const data = carregarSinais(specRoot);
  for (const f of findings) {
    registrar(data, { codigo: f.code, feature: f.feature, ref: refDoAchado(f), gitRev });
  }
  salvarSinais(specRoot, data, opts);
  return findings.length;
}

export function registrarVerify(specRoot, record, opts = {}) {
  const eventos = [];
  for (const [acId, r] of Object.entries(record.results || {})) {
    if (r.status === 'fail') eventos.push({ codigo: 'VERIFY_FALHOU', ref: acId });
    else if (r.status === 'skip') eventos.push({ codigo: 'VERIFY_PULADO', ref: acId });
  }
  for (const [pId, r] of Object.entries(record.principles || {})) {
    if (r.status !== 'pass') eventos.push({ codigo: 'VERIFY_FALHOU', ref: pId });
  }
  if (!eventos.length || !existsSync(specRoot)) return 0;
  const data = carregarSinais(specRoot);
  for (const e of eventos) {
    registrar(data, { ...e, feature: record.feature, gitRev: record.gitRev });
  }
  salvarSinais(specRoot, data, opts);
  return eventos.length;
}

// O sinal que dá lastro a uma lição: mesmo código, mesma feature (ou sinal
// global, sem feature) e fonte que corresponde ao ref registrado.
export function buscarSinal(data, { sinal, feature, fonte }) {
  if (!fonte) return null;
  const candidatos = Object.values(data.sinais).filter(
    (s) => s.codigo === sinal && (s.feature === feature || s.feature === '—')
  );
  const exato = candidatos.find((s) => s.ref === fonte);
  if (exato) return exato;
  if (fonte.length < 4) return null;
  return (
    candidatos.find(
      (s) => s.ref !== '—' && (fonte.includes(s.ref) || s.ref.includes(fonte))
    ) || null
  );
}

export function refsDisponiveis(data, { sinal, feature }) {
  return [
    ...new Set(
      Object.values(data.sinais)
        .filter((s) => s.codigo === sinal && (s.feature === feature || s.feature === '—'))
        .map((s) => s.ref)
    ),
  ];
}
