// Renderização dos resultados de audit — terminal, JSON e markdown.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};

export function renderTerminal(audit) {
  const lines = [];
  const { findings, stats, ok } = audit;

  for (const f of findings) {
    const tag = f.severity === 'erro' ? c.red('ERRO ') : c.yellow('AVISO');
    const loc = f.file ? c.dim(` ${f.file}${f.line ? `:${f.line}` : ''}`) : '';
    const feat = f.feature ? c.dim(`[${f.feature}] `) : '';
    lines.push(`${tag} ${c.bold(f.code)} ${feat}${f.message}${loc}`);
  }

  if (findings.length) lines.push('');
  lines.push(
    `${c.bold('resumo:')} ${stats.features} feature(s) · ${stats.stories} US · ${stats.acs} AC ` +
      `· ${stats.acsWithTest}/${stats.acs} com teste · ${stats.acsProven}/${stats.acs} provados` +
      (stats.assumptionsOpen ? ` · ${c.yellow(`${stats.assumptionsOpen} suposição(ões) aberta(s)`)}` : '') +
      (stats.questionsOpen ? ` · ${c.yellow(`${stats.questionsOpen} pergunta(s) aberta(s)`)}` : '')
  );
  lines.push(
    ok
      ? c.green(`✔ auditoria limpa (${stats.warnings} aviso(s))`)
      : c.red(`✘ ${stats.errors} erro(s), ${stats.warnings} aviso(s)`)
  );
  return lines.join('\n');
}

export function renderJson(audit) {
  return JSON.stringify({ ok: audit.ok, stats: audit.stats, findings: audit.findings }, null, 2);
}

export function renderMarkdown(audit, { title = 'Relatório de auditoria' } = {}) {
  const { findings, stats, ok } = audit;
  const lines = [`# ${title}`, ''];
  lines.push(`- Resultado: ${ok ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- Features: ${stats.features} · Histórias: ${stats.stories} · ACs: ${stats.acs}`);
  lines.push(`- ACs com teste: ${stats.acsWithTest}/${stats.acs} · ACs provados: ${stats.acsProven}/${stats.acs}`);
  lines.push(`- Suposições abertas: ${stats.assumptionsOpen} · Perguntas abertas: ${stats.questionsOpen}`);
  lines.push('');
  if (findings.length) {
    lines.push('| Severidade | Código | Feature | Achado | Local |');
    lines.push('|---|---|---|---|---|');
    for (const f of findings) {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '—';
      lines.push(
        `| ${f.severity} | ${f.code} | ${f.feature || '—'} | ${f.message.replace(/\|/g, '\\|')} | ${loc} |`
      );
    }
  } else {
    lines.push('Nenhum achado. Spec e código alinhados.');
  }
  lines.push('');
  return lines.join('\n');
}
