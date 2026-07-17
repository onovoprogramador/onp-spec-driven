#!/usr/bin/env node
import { run } from '../src/cli.js';

// process.exitCode (e não process.exit()): garante o flush do stdout em pipes.
// Com process.exit(), saídas grandes (audit --json) eram truncadas em ~8KB.
run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`erro: ${err.message}`);
    process.exitCode = 2;
  }
);
