#!/usr/bin/env node
import { run } from '../src/cli.js';

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`erro: ${err.message}`);
    process.exit(2);
  }
);
