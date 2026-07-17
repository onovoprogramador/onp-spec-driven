#!/usr/bin/env bash
# Prepara o benchmark clonando e compilando o OpenSpec (concorrente com
# validador mecânico real) para rodar a comparação AO VIVO. O spec-kit
# entra pela matriz de capacidade (verificada no código-fonte — ver
# benchmark/adapters/capability.js), então não precisa de build.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$DIR/.vendor"
mkdir -p "$VENDOR"

if [ ! -d "$VENDOR/OpenSpec" ]; then
  echo "→ clonando OpenSpec..."
  git clone --depth 1 https://github.com/Fission-AI/OpenSpec.git "$VENDOR/OpenSpec"
fi

cd "$VENDOR/OpenSpec"
echo "→ instalando dependências do OpenSpec..."
# --ignore-scripts: o postinstall do OpenSpec chama pnpm, que pode não existir;
# só precisamos das deps para o build TypeScript rodar.
npm install --no-package-lock --ignore-scripts --silent
echo "→ compilando OpenSpec..."
node build.js

echo "✔ pronto. rode: node benchmark/run.js"
