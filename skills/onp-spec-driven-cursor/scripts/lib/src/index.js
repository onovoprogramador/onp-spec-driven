// API pública programática do onp-spec-driven.
// Use quando quiser embutir a auditoria num script/CI próprio em vez do CLI.

export { loadConfig, DEFAULT_CONFIG } from './config.js';
export { loadProject } from './core/project.js';
export { auditProject } from './core/audit.js';
export { runVerify } from './core/verify.js';
export { scaffoldTests } from './core/scaffold.js';
export { renderTerminal, renderJson, renderMarkdown } from './core/report.js';
export {
  carregarSinais,
  salvarSinais,
  registrarAchados,
  registrarVerify,
  buscarSinal,
  SINAIS_DEFAULTS,
} from './core/sinais.js';
export {
  carregarLicoes,
  salvarLicoes,
  adicionarLicao,
  listarLicoes,
  penalizarLicao,
  podarLicoes,
  sugerirLicoes,
  renderLicoes,
  LICOES_DEFAULTS,
} from './core/licoes.js';
export { parseSpec, allAcs } from './parsers/spec.js';
export { parseTasks } from './parsers/tasks.js';
export { parseConstitution } from './parsers/constitution.js';
export { run as runCli } from './cli.js';
