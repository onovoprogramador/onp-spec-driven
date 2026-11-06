// Configuração do projeto — onpspec.config.json na raiz (opcional).
// Tudo tem default sensato: `npx onp-spec audit` funciona sem config.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { LICOES_DEFAULTS } from './core/licoes.js';

export const DEFAULT_CONFIG = {
  specDir: '.spec',
  // onde procurar tags @spec/@principle
  testGlobs: ['test/**', 'tests/**', 'src/**/*.test.*', 'src/**/*.spec.*', '__tests__/**'],
  // arquivos de implementação que precisam estar mapeados em alguma task
  srcGlobs: ['src/**'],
  ignoreGlobs: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'coverage/**', '.spec/**'],
  // comando que roda os testes; usado por `onp-spec verify`
  testCommand: null,
  // como interpretar a saída: tap | vitest-json | jest-json | exitcode
  reporter: 'tap',
  // arquivo de saída para reporters json (vitest-json/jest-json)
  reporterOutputFile: null,
  // camada de lições: limiares de promoção/quarentena, janela e tetos
  licoes: { ...LICOES_DEFAULTS },
  // plano de execução (onp-spec plano): paralelismo e defaults do executor
  paralelo: {
    // máximo de faixas rodando ao mesmo tempo numa onda
    maxParalelas: 3,
    // null resolve o default real do catálogo do harness na execução.
    model: null,
    // esforço default: baixo|medio|alto|xalto|max (ou low|medium|high|xhigh|max)
    esforco: 'medium',
    // modo de permissão do claude headless; para rodar 100% sem prompts o
    // usuário pode trocar para bypassPermissions (decisão explícita dele)
    permissionMode: 'acceptEdits',
    // override da lista --allowedTools (null = derivada do testCommand + git)
    allowedTools: null,
    // sandbox do codex headless (`codex exec --sandbox`); para liberar rede
    // e caminhos fora do workspace o usuário pode trocar para
    // danger-full-access (decisão explícita dele)
    sandbox: 'workspace-write',
    // Probe/hook nativo opcional: [executável, ...args]; sem shell.
    quotaCommand: null,
    modelsCommand: null,
    notifications: { enabled: false, command: null },
    quota: { thresholdPercent: 5, pollIntervalMs: 60000 },
  },
};

export function loadConfig(rootDir) {
  const configPath = path.join(rootDir, 'onpspec.config.json');
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, rootDir, configPath: null };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    throw new Error(`onpspec.config.json inválido: ${err.message}`);
  }
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    licoes: { ...DEFAULT_CONFIG.licoes, ...(raw.licoes || {}) },
    paralelo: { ...DEFAULT_CONFIG.paralelo, ...(raw.paralelo || {}) },
    rootDir,
    configPath,
  };
}
