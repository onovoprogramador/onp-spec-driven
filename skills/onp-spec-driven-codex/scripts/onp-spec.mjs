#!/usr/bin/env node
// Entrypoint do motor embarcado da skill onp-spec-driven.
// Uso (a partir da RAIZ do projeto do usuário):
//   node <dir-da-skill>/scripts/onp-spec.mjs <comando> [opções]
// Gerado por tools/build-skill.mjs — não edite à mão; edite src/ e regenere.
import { run } from './lib/src/cli.js';

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`erro: ${err.message}`);
    process.exitCode = 2;
  }
);
