// Painel ao vivo — `onp-spec painel [feature]` sobe um servidor HTTP local
// (node:http, zero dependências, SÓ em 127.0.0.1) que mostra TODAS as
// execuções, de TODOS os projetos, a partir do ledger global único
// (~/.onp-spec/painel/ledger.jsonl) — ver src/core/ledger.js.
//
// O que dá para fazer olhando:
//   - árvore projeto → execução → faixa → tarefa, com estado ao vivo
//   - o stream do modelo por tarefa: ferramenta chamada, raciocínio (tokens),
//     saída da ferramenta, texto e o resultado (turnos, duração, custo)
//   - executar tudo, REEXECUTAR só a faixa que falhou, ou só o gate
//
// Segurança: bind exclusivo em 127.0.0.1, checagem de Host e token de sessão
// nos POST (nenhuma página externa consegue disparar execução).

import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { spawn } from 'child_process';
import { readFileSync, existsSync, openSync, closeSync, mkdirSync, statSync, readSync } from 'fs';
import { lerEventos, montarArvore, lerStream, caminhos } from './ledger.js';

// ── leitura de logs do script (complemento do stream do modelo) ─────────────

export function tailArquivo(caminho, { maxBytes = 8192, maxLinhas = 40 } = {}) {
  try {
    const st = statSync(caminho);
    const fd = openSync(caminho, 'r');
    const inicio = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(Math.min(maxBytes, st.size));
    readSync(fd, buf, 0, buf.length, inicio);
    closeSync(fd);
    const linhas = buf.toString('utf-8').split('\n');
    if (inicio > 0 && linhas.length > 1) linhas.shift();
    return linhas.slice(-maxLinhas).join('\n').trimEnd();
  } catch {
    return '';
  }
}

function dirLogs(execucao) {
  if (!execucao?.projetoDir) return null;
  return path.join(path.dirname(execucao.projetoDir), 'onp-worktrees', `${execucao.projeto}-${execucao.feature}-logs`);
}

// ── estado que o painel serve ──────────────────────────────────────────────

export function montarEstadoGlobal({ projetoDir = null, feature = null, emExecucao = {} } = {}) {
  const projetos = montarArvore(lerEventos(), { projetoDir, feature });
  const agora = Date.now();
  for (const p of projetos) {
    for (const ex of p.execucoes) {
      // vivo de verdade: exitCode null = processo ainda em curso
      const filho = emExecucao[ex.runId];
      ex.disparadoAqui = Boolean(filho && filho.exitCode === null && filho.signalCode === null);
      if (ex.disparadoAqui) ex.rodando = true;
      else if (filho) ex.ultimoExitExecutor = filho.exitCode;
      // "sem novidade há X" ajuda a distinguir rodando de interrompido
      ex.silencioSeg = Math.round((agora - new Date(ex.atualizadoEm).getTime()) / 1000);
      const d = dirLogs(ex);
      ex.temLogs = Boolean(d && existsSync(d));
    }
  }
  return { projetos, atualizado: new Date().toISOString() };
}

function acharExecucao(runId) {
  for (const p of montarArvore(lerEventos())) {
    const ex = p.execucoes.find((e) => e.runId === runId);
    if (ex) return ex;
  }
  return null;
}

// ── página ─────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderPainelHtml({ titulo, token, escopo }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  :root {
    --bg:#f6f7f9; --fg:#15181c; --card:#fff; --card2:#fbfbfc; --borda:#e3e6ea; --sub:#666e78;
    --acc:#0a7c42; --azul:#0b64c0; --verm:#b3261e; --amar:#8a6d00; --amar-bg:#fff8e1;
    --term-bg:#0e1116; --term-fg:#c9d3de; --term-borda:#212936;
    --tool:#7fb2ff; --pensa:#c9a0ff; --saida:#8fd39a; --erro:#ff8e85;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1114; --fg:#e6e8ea; --card:#171a1f; --card2:#1c2027; --borda:#2a2f37; --sub:#98a1ac;
            --acc:#22a35e; --azul:#5aa2ee; --verm:#e5716b; --amar:#e0c36a; --amar-bg:#2a2410; }
  }
  * { box-sizing:border-box }
  html,body { height:100% }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif }
  code,.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace }
  button { font:inherit; cursor:pointer; border:1px solid var(--borda); background:var(--card);
           color:var(--fg); border-radius:7px; padding:.35rem .7rem }
  button:hover:not(:disabled) { border-color:var(--sub) }
  button:disabled { opacity:.45; cursor:default }
  button.primario { background:var(--acc); border-color:transparent; color:#fff; font-weight:600; padding:.5rem .9rem }
  button.perigo { background:var(--verm); border-color:transparent; color:#fff; font-weight:600 }

  /* layout */
  .app { display:grid; grid-template-rows:auto 1fr; height:100vh }
  header { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap;
           padding:.7rem 1rem; border-bottom:1px solid var(--borda); background:var(--card) }
  header h1 { font-size:1rem; margin:0; font-weight:700 }
  .corpo { display:grid; grid-template-columns:min(30rem,34%) 1fr; overflow:hidden }
  @media (max-width:52rem) { .corpo { grid-template-columns:1fr; grid-template-rows:auto 1fr } }
  aside { overflow-y:auto; border-right:1px solid var(--borda); padding:.75rem; background:var(--card2) }
  @media (max-width:52rem) { aside { max-height:42vh; border-right:0; border-bottom:1px solid var(--borda) } }
  main { overflow:hidden; display:flex; flex-direction:column; min-height:0 }

  /* chips de estado */
  .chip { border-radius:999px; padding:.1rem .55rem; font-size:.72rem; font-weight:700;
          background:var(--borda); color:var(--fg); white-space:nowrap; letter-spacing:.01em }
  .chip.viva { background:var(--azul); color:#fff; animation:pulsa 1.3s ease-in-out infinite }
  .chip.ok { background:var(--acc); color:#fff }
  .chip.ruim { background:var(--verm); color:#fff }
  .chip.aviso { background:var(--amar); color:#151515 }
  @keyframes pulsa { 50% { opacity:.5 } }
  .pisca { animation:pulsa 1.3s ease-in-out infinite }

  /* árvore */
  .proj { margin-bottom:1rem }
  .proj > h2 { font-size:.78rem; text-transform:uppercase; letter-spacing:.06em; color:var(--sub);
               margin:0 0 .4rem; display:flex; align-items:center; gap:.4rem }
  .exec { background:var(--card); border:1px solid var(--borda); border-radius:9px;
          padding:.55rem .65rem; margin-bottom:.5rem }
  .exec.sel { border-color:var(--azul); box-shadow:0 0 0 1px var(--azul) inset }
  .exec > .cab { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; cursor:pointer }
  .exec .feat { font-weight:700 }
  .exec .meta { font-size:.75rem; color:var(--sub); margin-left:auto }
  .barra { height:4px; border-radius:2px; background:var(--borda); margin:.45rem 0; overflow:hidden }
  .barra > i { display:block; height:100%; background:var(--acc); transition:width .4s }
  .faixa { border-top:1px dashed var(--borda); padding:.4rem 0 .2rem }
  .faixa > .cab { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap }
  .faixa .nome { font-size:.8rem; font-weight:600 }
  .tar { display:flex; align-items:center; gap:.4rem; padding:.2rem 0 .2rem .5rem;
         border-radius:6px; cursor:pointer; font-size:.85rem }
  .tar:hover { background:var(--card2) }
  .tar.sel { background:var(--azul); color:#fff }
  .tar.sel .tsub { color:#e7f0fb }
  .tid { font:700 .74rem ui-monospace,monospace; color:var(--acc); white-space:nowrap }
  .tar.sel .tid { color:#fff }
  .ttit { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .tsub { margin-left:auto; font-size:.7rem; color:var(--sub); white-space:nowrap }
  .ponto { width:.5rem; height:.5rem; border-radius:50%; background:var(--borda); flex:none }
  .ponto.exec { background:var(--azul) } .ponto.ok { background:var(--acc) }
  .ponto.ruim { background:var(--verm) }

  /* detalhe */
  .detcab { padding:.7rem 1rem; border-bottom:1px solid var(--borda); background:var(--card);
            display:flex; align-items:center; gap:.5rem; flex-wrap:wrap }
  .detcab h2 { font-size:.95rem; margin:0 }
  .detcab .acoes { margin-left:auto; display:flex; gap:.4rem; flex-wrap:wrap }
  .term { flex:1 1 auto; min-height:0; overflow-y:auto; background:var(--term-bg); color:var(--term-fg);
          padding:.8rem 1rem; font:.78rem/1.6 ui-monospace,SFMono-Regular,Menlo,monospace }
  .detcab { flex:none }
  .ev { display:grid; grid-template-columns:1.4rem 1fr; gap:.5rem; padding:.18rem 0;
        border-bottom:1px solid var(--term-borda) }
  .ev:last-child { border-bottom:0 }
  .ev .ic { text-align:center; opacity:.9 }
  .ev .txt { white-space:pre-wrap; overflow-wrap:anywhere; min-width:0 }
  .ev .lab { font-weight:700 }
  .ev.ferramenta .lab { color:var(--tool) }
  .ev.pensando .lab { color:var(--pensa) } .ev.pensando .txt { opacity:.85; font-style:italic }
  .ev.saida .txt { color:var(--saida); opacity:.85 }
  .ev.saida.erro .txt { color:var(--erro) }
  .ev.texto .txt { color:#fff }
  .ev.fim .txt { color:var(--saida); font-weight:700 }
  .ev.inicio .txt { opacity:.7 }
  .ev details summary { cursor:pointer; opacity:.6 }
  .ev pre { margin:.3rem 0 0; padding:.4rem .5rem; background:#00000055; border-radius:6px;
            overflow-x:auto; font-size:.74rem }
  .vazio { padding:2rem 1rem; color:var(--sub); text-align:center }
  .aviso-box { background:var(--amar-bg); color:var(--amar); border-radius:8px; padding:.45rem .7rem;
               font-size:.8rem; margin:.4rem 0 }
  .abas { display:flex; gap:.3rem }
  .abas button.on { background:var(--azul); color:#fff; border-color:transparent }
  .sub { color:var(--sub) } .flexcol { display:flex; flex-direction:column; min-height:0 }
</style>
</head>
<body>
<div class="app">
  <header>
    <h1>onp-spec · plano ao vivo</h1>
    <span id="escopo" class="sub" style="font-size:.8rem">${esc(escopo)}</span>
    <span id="global" class="chip">carregando…</span>
    <span id="hora" class="sub" style="margin-left:auto; font-size:.75rem"></span>
  </header>
  <div class="corpo">
    <aside id="arvore"><p class="sub">lendo o ledger…</p></aside>
    <main class="flexcol">
      <div class="detcab">
        <h2 id="dettit">nada selecionado</h2>
        <span id="detchip"></span>
        <div class="acoes" id="detacoes"></div>
      </div>
      <div class="term" id="term"><p class="vazio">Selecione uma tarefa na árvore para ver o que o modelo está fazendo — ou clique em <b>Executar tudo</b> numa execução.</p></div>
    </main>
  </div>
</div>
<script>
var TOKEN = ${JSON.stringify(token)};
var sel = null;          // {runId, chave, tarefa, tipo:'tarefa'|'log'}
var selManual = false;   // usuário escolheu? então não roubo o foco dele
var cursores = {};       // chave do stream → linhas já renderizadas
var ultimoEstado = null;

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function dur(ms){ if(ms==null) return ''; var s=ms/1000; return s<60? s.toFixed(1)+'s' : Math.floor(s/60)+'m'+Math.round(s%60)+'s'; }

// ── árvore ────────────────────────────────────────────────────────────────
function chipFaixa(st){
  var m={executando:['viva','executando'],mesclando:['viva','mesclando'],mesclada:['ok','mesclada'],
         conflito:['ruim','conflito'],falhou:['ruim','falhou'],aguardando:['','aguardando']};
  var v=m[st]||['','?']; return '<span class="chip '+v[0]+'">'+v[1]+'</span>';
}
function pontoTarefa(st){
  var c = st==='executando'?'exec':st==='concluida'?'ok':st==='falhou'?'ruim':'';
  return '<span class="ponto '+c+'"></span>';
}
function chipExec(ex){
  if (ex.rodando) return '<span class="chip viva">executando</span>';
  // só é "concluída" com veredito FRESCO do audit: sem isso, nada de verde
  if (ex.fim===0 && ex.gate.audit===0 && !ex.gateDesatualizado) return '<span class="chip ok">concluída ✔</span>';
  if (ex.gateDesatualizado) return '<span class="chip aviso">gate desatualizado</span>';
  if (ex.fim===1) return '<span class="chip ruim">pendências</span>';
  if (ex.falhas) return '<span class="chip ruim">'+ex.falhas+' falha(s)</span>';
  if (ex.concluidas===ex.total && ex.total) return '<span class="chip aviso">gate pendente</span>';
  return '<span class="chip">pronta</span>';
}

function desenharArvore(est){
  var h='';
  if(!est.projetos.length){
    h='<p class="sub">Nenhuma execução no ledger ainda.<br><br>Gere um plano no seu projeto:<br><code>onp-spec plano &lt;feature&gt;</code></p>';
    document.getElementById('arvore').innerHTML=h; return;
  }
  est.projetos.forEach(function(p){
    var vivo = p.execucoes.some(function(e){return e.rodando});
    h+='<div class="proj"><h2>'+esc(p.projeto)+(vivo?' <span class="chip viva">rodando</span>':'')+'</h2>';
    p.execucoes.forEach(function(ex){
      var selEx = sel && sel.runId===ex.runId;
      h+='<div class="exec'+(selEx?' sel':'')+'" data-run="'+esc(ex.runId)+'">';
      h+='<div class="cab" onclick="alternarExec(\\''+esc(ex.runId)+'\\')">';
      h+='<span class="feat">'+esc(ex.feature)+'</span>'+chipExec(ex);
      h+='<span class="meta">'+ex.concluidas+'/'+ex.total+' tarefas'+(ex.rodando?' · '+ex.silencioSeg+'s':'')+'</span></div>';
      h+='<div class="barra"><i style="width:'+(ex.total? Math.round(100*ex.concluidas/ex.total):0)+'%"></i></div>';
      ex.faixas.forEach(function(fx){
        h+='<div class="faixa"><div class="cab"><span class="nome">'+esc(fx.id)+'</span>'+chipFaixa(fx.estado);
        if(fx.tentativa>1) h+='<span class="chip aviso">tentativa '+fx.tentativa+'</span>';
        if((fx.estado==='falhou'||fx.estado==='conflito') && ex.agent==='claude')
          h+='<button onclick="executar(\\''+esc(ex.runId)+'\\',\\'faixa:'+esc(fx.id)+'\\',event)">↻ reexecutar</button>';
        h+='</div>';
        fx.tarefas.forEach(function(t){ h+=linhaTarefa(ex,fx.id,t) });
        h+='</div>';
      });
      if(ex.sequenciais.length){
        h+='<div class="faixa"><div class="cab"><span class="nome">sequenciais</span></div>';
        ex.sequenciais.forEach(function(t){ h+=linhaTarefa(ex,'seq',t) });
        h+='</div>';
      }
      h+='<div class="faixa"><div class="cab"><span class="nome">gate</span>';
      var velho = ex.gateDesatualizado;
      h+= (ex.gate.verify==null?'<span class="chip">verify</span>'
           :'<span class="chip '+(velho?'aviso':ex.gate.verify===0?'ok':'ruim')+'">verify '+(ex.gate.verify===0?'✔':'✘')+'</span>');
      h+= (ex.gate.audit==null?'<span class="chip">audit</span>'
           :'<span class="chip '+(velho?'aviso':ex.gate.audit===0?'ok':'ruim')+'">audit '+(ex.gate.audit===0?'✔ alinhado':'✘')+'</span>');
      if(velho) h+='<span class="sub" style="font-size:.72rem">← de antes do último trabalho; rode o gate</span>';
      h+='</div></div>';
      h+='<div class="cab" style="margin-top:.5rem;gap:.35rem">';
      if(ex.agent==='claude'){
        h+='<button class="primario" '+(ex.rodando?'disabled':'')+' onclick="executar(\\''+esc(ex.runId)+'\\',\\'tudo\\',event)">▶ Executar tudo</button>';
        h+='<button '+(ex.rodando?'disabled':'')+' onclick="executar(\\''+esc(ex.runId)+'\\',\\'gate\\',event)">gate</button>';
      } else {
        h+='<span class="sub" style="font-size:.75rem">Antigravity: execução nos agentes nativos — este painel acompanha</span>';
      }
      h+='<button onclick="verLog(\\''+esc(ex.runId)+'\\',event)">log do script</button>';
      h+='</div>';
      h+='</div>';
    });
    h+='</div>';
  });
  document.getElementById('arvore').innerHTML=h;
}
function linhaTarefa(ex,faixaId,t){
  var chave=faixaId+'--'+t.id;
  var s = sel && sel.runId===ex.runId && sel.chave===chave;
  return '<div class="tar'+(s?' sel':'')+'" onclick="selecionar(\\''+esc(ex.runId)+'\\',\\''+esc(chave)+'\\',\\''+esc(t.id)+'\\',true)">'
    + pontoTarefa(t.estado) + '<span class="tid">'+esc(t.id)+'</span>'
    + '<span class="ttit">'+esc(t.titulo)+'</span>'
    + '<span class="tsub">'+esc(t.modelo||'')+' · '+esc(t.esforco||'')+'</span></div>';
}

// ── seleção e stream ──────────────────────────────────────────────────────
function selecionar(runId,chave,tarefa,manual){
  if(sel && sel.runId===runId && sel.chave===chave && sel.tipo==='tarefa') return;
  sel={runId:runId,chave:chave,tarefa:tarefa,tipo:'tarefa'};
  if(manual) selManual=true;
  cursores[runId+'|'+chave]=0;
  document.getElementById('term').innerHTML='<p class="vazio">carregando stream…</p>';
  document.getElementById('dettit').textContent=tarefa+' · '+chave.split('--')[0];
  atualizarStream(true);
  if(ultimoEstado) desenharArvore(ultimoEstado);
}
function verLog(runId,ev){
  if(ev) ev.stopPropagation();
  sel={runId:runId,tipo:'log'}; selManual=true;
  document.getElementById('dettit').textContent='log do script';
  document.getElementById('detacoes').innerHTML='';
  document.getElementById('detchip').innerHTML='';
  atualizarStream(true);
  if(ultimoEstado) desenharArvore(ultimoEstado);
}

function icone(tipo){ return {ferramenta:'🔧',pensando:'💭',saida:'↳',texto:'🗣',fim:'✅',inicio:'▶',cru:'·'}[tipo]||'·'; }
function renderItem(it){
  var cls='ev '+it.tipo+(it.erro?' erro':'');
  var corpo='';
  if(it.tipo==='ferramenta'){
    corpo='<span class="lab">'+esc(it.nome)+'</span> '+esc(it.resumo);
    if(it.detalhe) corpo+='<details><summary>entrada completa</summary><pre>'+esc(it.detalhe)+'</pre></details>';
  } else if(it.tipo==='pensando'){
    corpo='<span class="lab">pensando</span>'+(it.tokens?' <span class="sub">('+it.tokens+' tokens)</span>':'')
        + (it.texto? '\\n'+esc(it.texto) : ' <span class="sub">— conteúdo não exposto no headless</span>');
  } else if(it.tipo==='saida'){
    corpo=(it.erro?'<span class="lab">erro</span> ':'')+esc(it.texto);
  } else if(it.tipo==='texto'){
    corpo=esc(it.texto);
  } else if(it.tipo==='inicio'){
    corpo='sessão '+esc(it.sessao)+' · modelo '+esc(it.modelo);
  } else if(it.tipo==='fim'){
    var p=[it.status]; if(it.turnos!=null)p.push(it.turnos+' turno(s)');
    if(it.duracaoMs!=null)p.push(dur(it.duracaoMs));
    if(it.custoUsd!=null)p.push('US$ '+it.custoUsd.toFixed(4));
    if(it.tokensSaida!=null)p.push(it.tokensSaida+' tokens de saída');
    corpo=esc(p.join(' · '))+(it.texto?'\\n<span class="sub">'+esc(it.texto)+'</span>':'');
  } else { corpo=esc(it.texto||''); }
  return '<div class="'+cls+'"><span class="ic">'+icone(it.tipo)+'</span><span class="txt">'+corpo+'</span></div>';
}

async function atualizarStream(recomeco){
  if(!sel) return;
  var term=document.getElementById('term');
  if(sel.tipo==='log'){
    var r=await fetch('/api/log?run='+encodeURIComponent(sel.runId));
    var d=await r.json();
    term.innerHTML = d.texto? '<div class="ev"><span class="ic">·</span><span class="txt">'+esc(d.texto)+'</span></div>'
                            : '<p class="vazio">sem log do script ainda (ele aparece quando a execução começa)</p>';
    term.scrollTop=term.scrollHeight; return;
  }
  var ck=sel.runId+'|'+sel.chave;
  var desde=cursores[ck]||0;
  var res=await fetch('/api/stream?run='+encodeURIComponent(sel.runId)+'&chave='+encodeURIComponent(sel.chave)+'&desde='+desde);
  var dados=await res.json();
  if(!dados.existe){
    if(recomeco) term.innerHTML='<p class="vazio">Esta tarefa ainda não rodou — sem stream do modelo.<br><span class="sub">Quando executar, o que o modelo faz aparece aqui em tempo real.</span></p>';
    return;
  }
  if(recomeco || desde===0) term.innerHTML='';
  var perto = term.scrollHeight - term.scrollTop - term.clientHeight < 60;
  if(dados.itens.length){
    // "pensando" é agregado no servidor: se o último item na tela é pensando
    // e o primeiro novo também, substitui em vez de duplicar
    var ultimo=term.lastElementChild;
    var novos=dados.itens.slice();
    if(ultimo && ultimo.classList && ultimo.classList.contains('pensando') && novos[0] && novos[0].tipo==='pensando'){
      ultimo.remove();
    }
    term.insertAdjacentHTML('beforeend', novos.map(renderItem).join(''));
  }
  cursores[ck]=dados.total;
  if(perto) term.scrollTop=term.scrollHeight;
  var chip=document.getElementById('detchip');
  chip.innerHTML = dados.resumo ? '<span class="chip '+(dados.resumo.status==='sucesso'?'ok':'ruim')+'">'+esc(dados.resumo.status)+'</span>'
                                : '<span class="chip viva">em curso</span>';
}

// ── ações ────────────────────────────────────────────────────────────────
async function executar(runId,escopo,ev){
  if(ev) ev.stopPropagation();
  var r=await fetch('/executar',{method:'POST',headers:{'x-onp-token':TOKEN,'content-type':'application/json'},
                                 body:JSON.stringify({runId:runId,escopo:escopo})});
  if(!r.ok){ alert('não consegui executar: '+(await r.text())); return; }
  // reexecutou uma faixa? abre a primeira tarefa dela na hora, para o usuário
  // ver o modelo trabalhando exatamente no que ele pediu
  if(escopo && escopo.indexOf('faixa:')===0 && ultimoEstado){
    var fid=escopo.slice(6);
    ultimoEstado.projetos.forEach(function(p){ p.execucoes.forEach(function(ex){
      if(ex.runId!==runId) return;
      var fx=ex.faixas.filter(function(f){return f.id===fid})[0];
      if(fx && fx.tarefas.length) selecionar(runId, fid+'--'+fx.tarefas[0].id, fx.tarefas[0].id, false);
    })});
  }
  selManual=false; // volta a seguir automaticamente quem estiver rodando
  atualizar();
}
function alternarExec(runId){ selManual=false; sel={runId:runId,tipo:'log'}; verLog(runId); }

// Segue automaticamente o que está acontecendo: prioriza tarefa EM EXECUÇÃO;
// se nada roda, abre a última tarefa que já produziu stream — assim o painel
// nunca fica com o lado direito vazio sem motivo.
function autoSeguir(est){
  if(selManual) return;
  var executando=null, falhou=null, ultimaComStream=null;
  est.projetos.forEach(function(p){ p.execucoes.forEach(function(ex){
    var todas=[];
    ex.faixas.forEach(function(fx){ fx.tarefas.forEach(function(t){
      todas.push({chave:fx.id+'--'+t.id,id:t.id,estado:t.estado,stream:t.stream}); }); });
    ex.sequenciais.forEach(function(t){
      todas.push({chave:'seq--'+t.id,id:t.id,estado:t.estado,stream:t.stream}); });
    todas.forEach(function(t){
      if(t.estado==='executando' && !executando) executando={runId:ex.runId,chave:t.chave,id:t.id};
      // falha é onde a atenção importa: ganha da última que deu certo
      if(t.estado==='falhou' && t.stream && !falhou) falhou={runId:ex.runId,chave:t.chave,id:t.id};
      if(t.stream) ultimaComStream={runId:ex.runId,chave:t.chave,id:t.id};
    });
  })});
  var alvo=executando||falhou||ultimaComStream;
  if(!alvo) return;
  if(sel && sel.tipo==='tarefa' && sel.runId===alvo.runId && sel.chave===alvo.chave) return;
  var manteve=selManual;
  selecionar(alvo.runId,alvo.chave,alvo.id,false);
  selManual=manteve;
}

async function atualizar(){
  try{
    var est=await (await fetch('/api/estado')).json();
    ultimoEstado=est;
    var vivas=0, ok=0, ruins=0;
    est.projetos.forEach(function(p){p.execucoes.forEach(function(e){
      if(e.rodando)vivas++; else if(e.fim===0)ok++; else if(e.fim===1||e.falhas)ruins++; })});
    var g=document.getElementById('global');
    if(vivas){ g.className='chip viva'; g.textContent=vivas+' execução(ões) rodando'; }
    else if(ruins){ g.className='chip ruim'; g.textContent=ruins+' com pendências'; }
    else if(ok){ g.className='chip ok'; g.textContent='tudo concluído'; }
    else { g.className='chip'; g.textContent='parado'; }
    document.getElementById('hora').textContent='atualizado '+new Date(est.atualizado).toLocaleTimeString();
    autoSeguir(est);
    desenharArvore(est);
    if(sel) atualizarStream(false);
  }catch(e){
    var g2=document.getElementById('global'); g2.className='chip ruim'; g2.textContent='painel desligado';
  }
}
atualizar();
setInterval(atualizar,1000);
</script>
</body>
</html>
`;
}

// ── servidor ───────────────────────────────────────────────────────────────

function hostLocal(req) {
  const host = String(req.headers.host || '');
  return host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]');
}

function corpoJson(req) {
  return new Promise((resolve) => {
    let dados = '';
    req.on('data', (c) => {
      dados += c;
      if (dados.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(dados || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// escopo → argumentos do executar-tarefas.sh
export function argsDoEscopo(escopo) {
  const e = String(escopo || 'tudo');
  if (e === 'tudo') return [];
  if (e === 'gate') return ['--gate'];
  if (e.startsWith('faixa:')) return ['--faixa', e.slice(6)];
  if (e.startsWith('seq:')) return ['--seq', e.slice(4)];
  return null;
}

export function servirPainel({
  rootDir,
  specDir = '.spec',
  feature = null,
  global = false,
  porta = 4747,
  abrir = true,
  log = console.log,
}) {
  const token = crypto.randomBytes(16).toString('hex');
  const emExecucao = {}; // runId → child process disparado por este painel
  const filtro = global ? {} : { projetoDir: rootDir, feature };

  const server = http.createServer(async (req, res) => {
    if (!hostLocal(req)) {
      res.writeHead(403);
      return res.end('somente localhost');
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (codigo, dados) => {
      res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(dados));
    };

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        renderPainelHtml({
          titulo: global ? 'Painel onp-spec — todos os projetos' : `Painel — ${feature}`,
          token,
          escopo: global ? 'todos os projetos' : `${path.basename(rootDir)} · ${feature}`,
        })
      );
    }

    if (req.method === 'GET' && url.pathname === '/api/estado') {
      return json(200, montarEstadoGlobal({ ...filtro, emExecucao }));
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const runId = url.searchParams.get('run');
      const chave = url.searchParams.get('chave');
      const desde = parseInt(url.searchParams.get('desde'), 10) || 0;
      if (!runId || !chave) return json(400, { erro: 'faltou run/chave' });
      return json(200, lerStream(runId, chave, { desde }));
    }

    if (req.method === 'GET' && url.pathname === '/api/log') {
      const ex = acharExecucao(url.searchParams.get('run'));
      const faixa = url.searchParams.get('faixa');
      if (!ex) return json(404, { erro: 'execução desconhecida' });
      const dir = dirLogs(ex);
      if (!dir) return json(200, { texto: '' });
      const arquivos = faixa ? [`${faixa}.log`] : ['execucao.log', 'seq.log'];
      const partes = [];
      for (const a of arquivos) {
        const t = tailArquivo(path.join(dir, a));
        if (t) partes.push(`── ${a} ──\n${t}`);
      }
      return json(200, { texto: partes.join('\n\n') });
    }

    if (req.method === 'POST' && url.pathname === '/executar') {
      if (req.headers['x-onp-token'] !== token) {
        res.writeHead(403);
        return res.end('token inválido');
      }
      const { runId, escopo } = await corpoJson(req);
      const ex = acharExecucao(runId);
      if (!ex) {
        res.writeHead(404);
        return res.end('execução desconhecida no ledger');
      }
      if (ex.agent !== 'claude') {
        res.writeHead(409);
        return res.end('plano do Antigravity: a execução é nos agentes nativos — este painel só acompanha');
      }
      if (emExecucao[runId] && emExecucao[runId].exitCode === null) {
        res.writeHead(409);
        return res.end('esta execução já está rodando');
      }
      const args = argsDoEscopo(escopo);
      if (!args) {
        res.writeHead(400);
        return res.end(`escopo inválido: ${escopo}`);
      }
      const sh = path.join(ex.projetoDir, ex.baseDir, 'executar-tarefas.sh');
      if (!existsSync(sh)) {
        res.writeHead(404);
        return res.end(`executar-tarefas.sh não existe — rode: onp-spec plano ${ex.feature}`);
      }
      try {
        const dir = dirLogs(ex);
        mkdirSync(dir, { recursive: true });
        const saida = openSync(path.join(dir, 'execucao.log'), 'w');
        const filho = spawn('bash', [sh, ...args], {
          cwd: ex.projetoDir,
          stdio: ['ignore', saida, saida],
        });
        filho.on('exit', () => closeSync(saida));
        emExecucao[runId] = filho;
        res.writeHead(202);
        return res.end(`executando ${escopo || 'tudo'}`);
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
        if (err.code === 'EADDRINUSE' && tentativas < 12) {
          tentativas += 1;
          tentar(p + 1);
        } else {
          reject(err);
        }
      });
      server.listen(p, '127.0.0.1', () => {
        const portaReal = server.address().port;
        const endereco = `http://127.0.0.1:${portaReal}/`;
        log(`✔ painel ao vivo: ${endereco}  (Ctrl+C para parar)`);
        log(`  ledger global: ${caminhos().ledger}`);
        if (abrir) {
          const abridor = process.platform === 'darwin' ? 'open' : 'xdg-open';
          try {
            spawn(abridor, [endereco], { stdio: 'ignore', detached: true }).unref();
          } catch {
            // sem navegador — a URL já foi impressa
          }
        }
        resolve({ server, porta: portaReal, url: endereco, token });
      });
    };
    tentar(porta);
  });
}
