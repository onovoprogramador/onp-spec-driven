// Configuração do projeto — onpspec.config.json na raiz (opcional).
// Tudo tem default sensato: `npx onp-spec audit` funciona sem config.

import { readFileSync, existsSync } from 'fs';
import path from 'path';

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
  return { ...DEFAULT_CONFIG, ...raw, rootDir, configPath };
}
