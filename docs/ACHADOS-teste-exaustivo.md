# Achados — teste exaustivo da skill onp-spec-driven (17/07/2026)

Base: repo `onp/onp-spec-driven` (CLI `bin/onp-spec.js` + skill `skills/onp-spec-driven/`).
Método: ~80 cenários em sandboxes isoladas (runner.mjs 63, runner2.mjs 14, probes manuais).
Suíte própria: 41/41 PASS. Benchmark: 100% (9/9), baseline limpo. Pacote publicado no npm.

## CRÍTICOS — bypass do gate ou veredito falso

| # | Achado | Evidência |
|---|---|---|
| CR-1 | **Teste `skip`/`todo` conta como prova PASS.** TAP emite `ok ... # SKIP`; `parseTap` não lê diretivas → agente skipa o teste e `audit --ci` sai 0. Derruba a tese "o agente não consegue declarar vitória". | probe skip: `verify f: 1/1 PASS` com teste `{skip:true}` |
| CR-2 | **`[concluída]` (grafia correta em PT!) vira `pendente` em silêncio.** RE_TASK só aceita `concluida` sem acento; com acento cai no fallback "sem status" → `TASK_CONCLUIDA_SEM_PROVA` nunca dispara. | C3 |
| CR-3 | **Saída grande de `audit --json` é truncada** (~8KB): `process.exit()` no bin antes do flush do stdout → JSON inválido em CI/pipe. | G1: `len=8126`, JSON unterminated |
| CR-4 | **ReDoS na constituição trava o audit**: `verificação(proibido)` com regex patológica `(a+)+$` → 60s+ sem resposta (gate vira DoS). | H3: 60003ms (morto por timeout) |
| CR-5 | **Preset base torna o gate infechável no caminho feliz**: P-001 [DEVE] exige teste `@principle:P-001` que nenhum passo do fluxo cria → todo `audit` sai 1; usuário aprende a ignorar o gate. | E1b, I6 |

## ALTOS — falsos positivos/negativos

| # | Achado | Evidência |
|---|---|---|
| AL-1 | **NFD (macOS) quebra o parser**: "Então" decomposto não casa `RE_GWT` → `AC_INCOMPLETO` falso em spec correta. | B6 |
| AL-2 | **Caminho com espaço em `Arquivos:`** é partido por `[,\s]+` → falsos `ARQUIVO_INEXISTENTE` e mapeamento errado. | C4 |
| AL-3 | **GWT indentado (2 espaços)** → `AC_INCOMPLETO` falso (listas aninhadas são markdown comum). | B18 |
| AL-4 | **`verificação(obrigatório)` com glob que casa 0 arquivos passa em silêncio** — typo de glob desliga o princípio sem aviso. | D4 |
| AL-5 | **Nível desconhecido `[OBRIGATORIO]`** → princípio silenciosamente ignorado (não parseado, não acusado). | D7 |
| AL-6 | **Seções Suposições/Perguntas ausentes → nenhum achado.** O diferencial #3 ("obrigatórias") não é imposto mecanicamente; só há erro se a seção existe com ASM aberta. | I10 |
| AL-7 | **Tag `@spec:` em comentário/código morto silencia `AC_SEM_TESTE`** (o scanner casa qualquer linha); com reporter `exitcode`, o bypass é completo (todos ACs viram pass). | análise + E5 |

## MÉDIOS — semântica e UX

- MD-1 Refs entre features → `REF_QUEBRADA` mesmo com AC existente globalmente (IDs são globais, refs são locais — inconsistente). [I5]
- MD-2 `> feature:` nunca comparado ao nome do diretório — drift silencioso.
- MD-3 Rigidez silenciosa sem sugestão: `**dado**` minúsculo, `US-1` (2 dígitos), `[Concluida]` — nada de "você quis dizer". [B8, B17]
- MD-4 verify sem tag: mensagem "0/0 ACs" não diz que faltou `@spec:` no título. [I12]
- MD-5 Fallback vitest-json procura primeiro `{` do stdout — frágil com logs. [E9 — erro amigável, mas críptico]
- MD-6 Reporter `exitcode` dá prova PASS a TODOS os ACs (defendido apenas por AC_SEM_TESTE). [E5]

## SKILL-LEVEL — inadequação como skill do harness

- SK-1 SKILL.md dirige tudo via CLI `onp-spec` (npx/instalação global). Sem CLI instalada a skill é letra morta; em sandbox/offline falha. O usuário decidiu: **não deve depender de CLI**.
- SK-2 Sem loop de correção bounded: se o audit falha, a skill não diz quantas iterações tentar nem quando escalar ao usuário.
- SK-3 Sem instruções de commit atômico por task, sem estratégia de carregamento de contexto (quando ler references/), sem "safety valve" do auto-dimensionamento.
- SK-4 Sem instrução do que fazer quando o ambiente não tem `node`/test runner (degradação graciosa).
- SK-5 Skill instalada via `init --agents claude` é uma CÓPIA — divergência silenciosa entre repo e projetos.

## O que funciona bem (não regredir)

- Catálogo de achados com códigos estáveis e arquivo:linha — excelente.
- Rastreabilidade US→AC→T→teste e regra conservadora (1 falha derruba o AC) [E6].
- Continuidade global de IDs no `new` [I13]; ID_DUPLICADO cross-feature [B9].
- ASM_ABERTA bloqueando `implementada` [B15]; escalonamento --ci.
- Prova regravável fail→pass [I8]; verification corrompida → erro claro [I9]; VERIFY_OBSOLETO por mtime [E8].
- Erros amigáveis no bin (catch central) [A9, E3, E11, F7]; escala ótima (600 ACs em 52ms) [G1]; specs de 5MB ok [G3].
- Scaffold gera JS/PY válidos mesmo com títulos hostis [F4, F6]; teste aninhado em describe funciona [E7].
