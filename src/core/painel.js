// Painel ao vivo — `onp-spec painel <feature>` sobe um servidor HTTP local
// (node:http, zero dependências, SÓ em 127.0.0.1) que mostra o plano de
// execução acontecendo em tempo real: status por faixa, log de cada janela
// rolando, tarefas do tasks.md, provas do verify e o veredito do gate.
//
// Fontes de verdade, lidas a cada atualização (1s no cliente):
//   - plano.json               → estrutura (faixas, ondas, tarefas)
//   - <logs>/plano-eventos.log → trilha emitida pelo executar-tarefas.sh
//   - <logs>/*.log             → cauda dos logs por faixa/tarefa
//   - tasks.md + verification/ → estado mecânico (vale também no Antigravity,
//                                onde as faixas rodam em agentes nativos)
//
// O botão "Executar todas as tarefas em janelas limpas e paralelas" aqui
// executa DE VERDADE: o servidor é local e dispara o script. Proteções:
// bind exclusivo em 127.0.0.1, checagem de Host e token por sessão no POST.

import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync, mkdirSync } from 'fs';
import { parseTasks } from '../parsers/tasks.js';

// ── trilha de eventos ──────────────────────────────────────────────────────

export function parseEventos(texto) {
  const ex = {
    inicio: null,
    fim: null,
    ondaAtual: null,
    faixas: {},
    tarefas: {},
    seq: {},
    gate: { verify: null, audit: null },
    ultimoEvento: null,
  };
  for (const linha of String(texto || '').split('\n')) {
    const partes = linha.trim().split('|');
    if (partes.length < 2) continue;
    const [ts, tipo, ...resto] = partes;
    ex.ultimoEvento = ts;
    if (tipo === 'inicio') ex.inicio = ts;
    else if (tipo === 'onda') ex.ondaAtual = parseInt(resto[0], 10) || null;
    else if (tipo === 'faixa') {
      const [id, st, extra] = resto;
      if (st === 'exit') {
        // exit != 0 vira "falhou" no evento seguinte; exit 0 aguarda merge
        if ((parseInt(extra, 10) || 0) === 0) ex.faixas[id] = ex.faixas[id] === 'executando' ? 'mesclando' : ex.faixas[id];
      } else {
        ex.faixas[id] = st; // executando | mesclada | conflito | falhou
      }
    } else if (tipo === 'tarefa') ex.tarefas[resto[0]] = resto[1];
    else if (tipo === 'seq') ex.seq[resto[0]] = resto[1];
    else if (tipo === 'gate') {
      if (resto[0] === 'verify') ex.gate.verify = parseInt(resto[1], 10);
      if (resto[0] === 'audit') ex.gate.audit = parseInt(resto[1], 10);
    } else if (tipo === 'fim') ex.fim = parseInt(resto[0], 10);
  }
  return ex;
}

// cauda de um arquivo de log sem carregar ele inteiro
export function tailArquivo(caminho, { maxBytes = 8192, maxLinhas = 25 } = {}) {
  try {
    const st = statSync(caminho);
    const fd = openSync(caminho, 'r');
    const inicio = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(Math.min(maxBytes, st.size));
    readSync(fd, buf, 0, buf.length, inicio);
    closeSync(fd);
    const linhas = buf.toString('utf-8').split('\n');
    if (inicio > 0 && linhas.length > 1) linhas.shift(); // primeira pode vir cortada
    return linhas.slice(-maxLinhas).join('\n').trimEnd();
  } catch {
    return '';
  }
}

// ── estado consolidado ─────────────────────────────────────────────────────

function repoToplevel(rootDir) {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: rootDir, encoding: 'utf-8' }).trim();
  } catch {
    return rootDir;
  }
}

export function caminhoLogs(rootDir, plan) {
  return path.join(path.dirname(repoToplevel(rootDir)), 'onp-worktrees', `${plan.repoName}-${plan.feature}-logs`);
}

export function montarEstado({ rootDir, specDir, feature, executorAtivo = false, executorExit = null }) {
  const baseDir = path.join(rootDir, specDir, 'features', feature);
  const planoPath = path.join(baseDir, 'plano.json');
  if (!existsSync(planoPath)) {
    return { erro: `plano.json não encontrado — rode \`onp-spec plano ${feature}\` primeiro` };
  }
  let plan;
  try {
    plan = JSON.parse(readFileSync(planoPath, 'utf-8'));
  } catch (err) {
    return { erro: `plano.json inválido: ${err.message}` };
  }

  const logsDir = caminhoLogs(rootDir, plan);
  const eventosPath = path.join(logsDir, 'plano-eventos.log');
  const execucao = existsSync(eventosPath) ? parseEventos(readFileSync(eventosPath, 'utf-8')) : null;

  // rodando = processo disparado pelo painel vivo OU trilha aberta e recente
  let rodando = executorAtivo;
  if (!rodando && execucao && execucao.inicio && execucao.fim === null) {
    try {
      rodando = Date.now() - statSync(eventosPath).mtimeMs < 10 * 60 * 1000;
    } catch {
      rodando = false;
    }
  }

  // estado mecânico: tasks.md (fonte que também vale no Antigravity)
  const tasksMd = {};
  const tasksPath = path.join(baseDir, 'tasks.md');
  if (existsSync(tasksPath)) {
    for (const t of parseTasks(readFileSync(tasksPath, 'utf-8')).tasks) tasksMd[t.id] = t.status;
  }

  // provas do verify
  let provas = null;
  const verPath = path.join(rootDir, specDir, 'verification', `${feature}.json`);
  if (existsSync(verPath)) {
    try {
      const resultados = Object.values(JSON.parse(readFileSync(verPath, 'utf-8')).results || {});
      provas = { total: resultados.length, pass: resultados.filter((r) => r.status === 'pass').length };
    } catch {
      provas = null;
    }
  }

  // cauda dos logs por faixa e por tarefa sequencial + saída geral do executor
  const logs = {};
  for (const fx of plan.faixas) logs[fx.id] = tailArquivo(path.join(logsDir, `${fx.id}.log`));
  for (const t of plan.sequenciais) logs[t.id] = tailArquivo(path.join(logsDir, `${t.id}.log`));
  logs.execucao = tailArquivo(path.join(logsDir, 'execucao.log'));

  return {
    plan,
    execucao,
    rodando,
    executorExit,
    tasksMd,
    provas,
    logs,
    atualizado: new Date().toISOString(),
  };
}

// ── página do painel ───────────────────────────────────────────────────────

const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderPainelHtml({ feature, token, podeExecutar }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel — ${escAttr(feature)}</title>
<style>
  :root { --bg:#fafafa; --fg:#1a1a1a; --card:#fff; --borda:#e2e2e2; --sub:#666;
          --acc:#0a7c42; --acc-fg:#fff; --azul:#0b64c0; --verm:#b3261e;
          --aviso-bg:#fff8e1; --aviso:#8a6d00; --log-bg:#101418; --log-fg:#cdd6dd; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#eaeaea; --card:#1e1e1e; --borda:#333; --sub:#9a9a9a;
            --acc:#17a35c; --azul:#4f9de8; --verm:#e5716b; --aviso-bg:#2a2410; --aviso:#e0c36a; }
  }
  * { box-sizing:border-box }
  body { margin:0; padding:1.5rem 1rem; background:var(--bg); color:var(--fg);
         font:14px/1.5 system-ui,-apple-system,sans-serif }
  main { max-width:72rem; margin:0 auto }
  h1 { font-size:1.3rem; margin:0 } h3 { margin:1.25rem 0 .5rem }
  code { font:.85em ui-monospace,monospace }
  .topo { display:flex; align-items:center; gap:.75rem; flex-wrap:wrap; margin-bottom:1rem }
  .chip { border-radius:999px; padding:.15rem .7rem; font-size:.8rem; font-weight:600;
          background:var(--borda); color:var(--fg) }
  .chip.executando { background:var(--azul); color:#fff; animation:pulsa 1.2s infinite }
  .chip.ok { background:var(--acc); color:#fff }
  .chip.erro { background:var(--verm); color:#fff }
  @keyframes pulsa { 50% { opacity:.55 } }
  button { background:var(--acc); color:var(--acc-fg); border:0; border-radius:8px;
           padding:.7rem 1.1rem; font:600 .95rem system-ui; cursor:pointer }
  button:disabled { opacity:.55; cursor:default }
  .banner { border-radius:10px; padding: .8rem 1rem; margin: .75rem 0; font-weight:600; display:none }
  .banner.ok { display:block; background:var(--acc); color:#fff }
  .banner.erro { display:block; background:var(--verm); color:#fff }
  .grade { display:grid; grid-template-columns:repeat(auto-fit,minmax(21rem,1fr)); gap:.75rem }
  .faixa { background:var(--card); border:1px solid var(--borda); border-radius:10px; padding:.8rem }
  .faixa h4 { margin:0 0 .4rem; display:flex; align-items:center; gap:.5rem; flex-wrap:wrap }
  .tarefa { display:flex; gap:.5rem; align-items:baseline; padding:.15rem 0; font-size:.9rem }
  .tid { font:700 .8rem ui-monospace,monospace; color:var(--acc); white-space:nowrap }
  .tst { margin-left:auto; font-size:.75rem; color:var(--sub); white-space:nowrap }
  pre.log { background:var(--log-bg); color:var(--log-fg); border-radius:8px; padding:.6rem;
            font:.72rem/1.45 ui-monospace,monospace; max-height:14rem; overflow:auto;
            white-space:pre-wrap; overflow-wrap:anywhere; margin:.5rem 0 0 }
  .sub { color:var(--sub) } .avisos { background:var(--aviso-bg); color:var(--aviso);
    border-radius:8px; padding:.5rem .8rem; margin:.6rem 0; font-size:.85rem }
</style>
</head>
<body>
<main>
  <div class="topo">
    <h1>Plano ao vivo — ${escAttr(feature)}</h1>
    <span id="fase" class="chip">carregando…</span>
    <span id="provas" class="sub"></span>
    <span id="hora" class="sub" style="margin-left:auto"></span>
  </div>
  ${podeExecutar ? `<button id="btn" onclick="executar()">▶ Executar todas as tarefas em janelas limpas e paralelas</button>
  <span id="btn-nota" class="sub"></span>` : `<p class="sub">Modo acompanhamento — a execução roda fora deste painel (agentes nativos do
  Antigravity, ou o script no terminal); aqui você vê tasks.md, logs, provas e o gate ao vivo.</p>`}
  <div id="banner" class="banner"></div>
  <div id="avisos"></div>
  <div id="conteudo"><p class="sub">carregando estado…</p></div>
</main>
<script>
  var TOKEN = ${JSON.stringify(token)};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }

  function chipFaixa(st) {
    if (st === 'executando' || st === 'mesclando') return '<span class="chip executando">' + esc(st) + '</span>';
    if (st === 'mesclada') return '<span class="chip ok">mesclada</span>';
    if (st === 'conflito' || st === 'falhou') return '<span class="chip erro">' + esc(st) + '</span>';
    return '<span class="chip">aguardando</span>';
  }
  function stTarefa(e, id) {
    var md = e.tasksMd[id] || 'pendente';
    var ev = (e.execucao && (e.execucao.tarefas[id] || e.execucao.seq[id])) || null;
    return ev || md;
  }
  function render(e) {
    var ex = e.execucao;
    var fase = document.getElementById('fase');
    if (e.rodando) { fase.textContent = 'executando'; fase.className = 'chip executando'; }
    else if (ex && ex.fim === 0) { fase.textContent = 'concluído ✔'; fase.className = 'chip ok'; }
    else if (ex && ex.fim === 1) { fase.textContent = 'com pendências'; fase.className = 'chip erro'; }
    else { fase.textContent = 'pronto para executar'; fase.className = 'chip'; }
    document.getElementById('hora').textContent = new Date(e.atualizado).toLocaleTimeString();
    document.getElementById('provas').textContent =
      e.provas ? e.provas.pass + '/' + e.provas.total + ' critérios provados' : '';

    var banner = document.getElementById('banner');
    banner.className = 'banner';
    banner.textContent = '';
    if (ex && ex.fim === 0) { banner.className = 'banner ok';
      banner.textContent = '✔ Especificação e código alinhados — audit saiu 0 na branch ' + e.plan.branchTrabalho; }
    else if (ex && ex.fim === 1) { banner.className = 'banner erro';
      banner.textContent = '✘ Plano terminou com pendências — veja o gate e os logs abaixo'; }
    else if (!e.rodando && e.executorExit != null && e.executorExit !== 0 && (!ex || ex.inicio == null)) {
      // o script morreu antes de começar (ambiente): mostra o motivo na cara
      banner.className = 'banner erro';
      banner.textContent = '✘ O executor parou antes de começar (exit ' + e.executorExit + '): ' +
        (e.logs.execucao || 'sem saída registrada').split('\\n').slice(-2).join(' — ');
    }

    var btn = document.getElementById('btn');
    if (btn) {
      btn.disabled = !!e.rodando;
      document.getElementById('btn-nota').textContent =
        e.rodando ? ' executando — acompanhe abaixo' : (ex && ex.fim != null ? ' reexecutar' : '');
    }

    document.getElementById('avisos').innerHTML = (e.plan.avisos || []).length
      ? '<div class="avisos">' + e.plan.avisos.map(function (a) { return '⚠ ' + esc(a); }).join('<br>') + '</div>' : '';

    var h = '';
    e.plan.ondas.forEach(function (onda, i) {
      h += '<h3>Onda ' + (i + 1) + ' <span class="sub">' + onda.join(' ∥ ') + '</span></h3><div class="grade">';
      onda.forEach(function (fid) {
        var fx = e.plan.faixas.filter(function (f) { return f.id === fid; })[0];
        var st = ex ? (ex.faixas[fid] || 'aguardando') : 'aguardando';
        h += '<div class="faixa"><h4>' + esc(fid) + ' ' + chipFaixa(st) +
             ' <span class="sub" style="font-weight:400">' + esc(fx.branch) + '</span></h4>';
        fx.tarefas.forEach(function (t) {
          h += '<div class="tarefa"><span class="tid">' + esc(t.id) + '</span> ' + esc(t.titulo) +
               '<span class="tst">' + esc(t.modelo) + ' · ' + esc(t.esforco) + ' · ' + esc(stTarefa(e, t.id)) + '</span></div>';
        });
        if (e.logs[fid]) h += '<pre class="log" data-log="' + esc(fid) + '">' + esc(e.logs[fid]) + '</pre>';
        h += '</div>';
      });
      h += '</div>';
    });
    if (e.plan.sequenciais.length) {
      h += '<h3>Sequenciais <span class="sub">após as ondas, na árvore principal</span></h3><div class="grade"><div class="faixa">';
      e.plan.sequenciais.forEach(function (t) {
        h += '<div class="tarefa"><span class="tid">' + esc(t.id) + '</span> ' + esc(t.titulo) +
             '<span class="tst">' + esc(t.modelo) + ' · ' + esc(t.esforco) + ' · ' + esc(stTarefa(e, t.id)) + '</span></div>';
        if (e.logs[t.id]) h += '<pre class="log" data-log="' + esc(t.id) + '">' + esc(e.logs[t.id]) + '</pre>';
      });
      h += '</div></div>';
    }
    if (ex && (ex.gate.verify != null || ex.gate.audit != null)) {
      h += '<h3>Gate</h3><div class="faixa" style="max-width:24rem">' +
           '<div class="tarefa"><span class="tid">verify</span><span class="tst">' +
           (ex.gate.verify == null ? '…' : ex.gate.verify === 0 ? 'exit 0 ✔' : 'exit ' + ex.gate.verify + ' ✘') + '</span></div>' +
           '<div class="tarefa"><span class="tid">audit --ci</span><span class="tst">' +
           (ex.gate.audit == null ? '…' : ex.gate.audit === 0 ? 'exit 0 ✔ (alinhado)' : 'exit ' + ex.gate.audit + ' ✘') + '</span></div></div>';
    }

    // preserva a rolagem dos logs que o usuário deixou no fim (autoscroll)
    var noFim = {};
    document.querySelectorAll('pre.log').forEach(function (p) {
      noFim[p.dataset.log] = p.scrollHeight - p.scrollTop - p.clientHeight < 12;
    });
    document.getElementById('conteudo').innerHTML = h;
    document.querySelectorAll('pre.log').forEach(function (p) {
      if (noFim[p.dataset.log] !== false) p.scrollTop = p.scrollHeight;
    });
  }

  async function atualizar() {
    try {
      var r = await fetch('/api/estado');
      var e = await r.json();
      if (e.erro) { document.getElementById('conteudo').innerHTML = '<p class="sub">' + esc(e.erro) + '</p>'; return; }
      render(e);
    } catch (err) {
      document.getElementById('fase').textContent = 'painel desligado';
      document.getElementById('fase').className = 'chip erro';
    }
  }
  async function executar() {
    var btn = document.getElementById('btn');
    btn.disabled = true;
    var r = await fetch('/executar', { method: 'POST', headers: { 'x-onp-token': TOKEN } });
    if (!r.ok) { alert('não consegui executar: ' + (await r.text())); btn.disabled = false; }
  }
  atualizar();
  setInterval(atualizar, 1000);
</script>
</body>
</html>
`;
}

// ── servidor ───────────────────────────────────────────────────────────────

function hostLocal(req) {
  const host = String(req.headers.host || '');
  return host.startsWith('127.0.0.1') || host.startsWith('localhost');
}

export function servirPainel({ rootDir, specDir, feature, agent, porta = 4747, abrir = true, log = console.log }) {
  const token = crypto.randomBytes(16).toString('hex');
  const baseDir = path.join(rootDir, specDir, 'features', feature);
  const shPath = path.join(baseDir, 'executar-tarefas.sh');
  const podeExecutar = agent === 'claude' && existsSync(shPath);
  let executor = null; // child do script quando disparado pelo painel
  let executorExit = null; // exit code da última execução disparada aqui

  const server = http.createServer((req, res) => {
    if (!hostLocal(req)) {
      res.writeHead(403);
      return res.end('somente localhost');
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(renderPainelHtml({ feature, token, podeExecutar }));
    }
    if (req.method === 'GET' && req.url === '/api/estado') {
      const estado = montarEstado({
        rootDir,
        specDir,
        feature,
        executorAtivo: Boolean(executor && executor.exitCode === null),
        executorExit,
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(estado));
    }
    if (req.method === 'POST' && req.url === '/executar') {
      if (req.headers['x-onp-token'] !== token) {
        res.writeHead(403);
        return res.end('token inválido');
      }
      if (!podeExecutar) {
        res.writeHead(404);
        return res.end(`executar-tarefas.sh não existe — rode: onp-spec plano ${feature}`);
      }
      if (executor && executor.exitCode === null) {
        res.writeHead(409);
        return res.end('o plano já está em execução');
      }
      try {
        const estado = montarEstado({ rootDir, specDir, feature });
        const logsDir = caminhoLogs(rootDir, estado.plan || { repoName: path.basename(rootDir), feature });
        mkdirSync(logsDir, { recursive: true });
        const saida = openSync(path.join(logsDir, 'execucao.log'), 'w');
        executorExit = null;
        executor = spawn('bash', [shPath], { cwd: rootDir, stdio: ['ignore', saida, saida] });
        executor.on('exit', (code) => {
          executorExit = code;
          closeSync(saida);
        });
        res.writeHead(202);
        return res.end('executando');
      } catch (err) {
        res.writeHead(500);
        return res.end(String(err.message || err));
      }
    }
    res.writeHead(404);
    res.end('não existe');
  });

  return new Promise((resolve, reject) => {
    let tentativas = 0;
    const tentar = (p) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && tentativas < 10) {
          tentativas += 1;
          tentar(p + 1);
        } else {
          reject(err);
        }
      });
      server.listen(p, '127.0.0.1', () => {
        const portaReal = server.address().port;
        const url = `http://127.0.0.1:${portaReal}/`;
        log(`✔ painel ao vivo: ${url}  (Ctrl+C para parar)`);
        if (abrir) {
          const abridor = process.platform === 'darwin' ? 'open' : 'xdg-open';
          try {
            spawn(abridor, [url], { stdio: 'ignore', detached: true }).unref();
          } catch {
            // sem navegador disponível — a URL já foi impressa
          }
        }
        resolve({ server, porta: portaReal, url, token });
      });
    };
    tentar(porta);
  });
}
