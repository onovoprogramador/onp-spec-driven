# Lições — aprendizado com lastro mecânico

A camada que faz o projeto melhorar de feature em feature sem virar um log
morto. A divisão que a mantém viva:

- **Você (agente) entra com o julgamento**: ler a falha e frasear a regra
  geral que teria evitado a recorrência.
- **O motor é dono de tudo mecânico**: lastro, IDs, dedup, recorrência por
  feature distinta, promoção candidata→confirmada, penalização→quarentena,
  poda e renderização. Você nunca faz essa contabilidade à mão — nem edita
  `licoes.json`/`LICOES.md` diretamente.

**O gate que torna isso seletivo**: `licoes add` só aceita uma lição que cita
um sinal REAL — um achado de audit ou uma falha/skip de verify que o próprio
motor registrou em `.spec/verification/sinais.json`. Lição sem sinal é opinião
e o motor recusa (`LICAO_SEM_LASTRO`). Você não decide sozinho o que é digno
de lição; o histórico decide com você.

## Arquivos (todos do motor)

| Arquivo | O que é |
|---|---|
| `.spec/verification/sinais.json` | histórico de sinais — escrito por `audit`/`verify`, nunca por você |
| `.spec/licoes.json` | estado canônico das lições — mutação só via `onp-spec licoes` |
| `.spec/LICOES.md` | renderização legível — leia; nunca escreva |

Status de lição: `candidata` (1 feature — registrada, não confiada) →
`confirmada` (recorreu em 2+ features distintas — vira guia) →
`quarentena` (aplicada e a falha recorreu — ignorada).

## LER — no Especificar (e no Projetar, se houver design.md)

Obrigatório e barato (teto fixo de itens, não cresce com o repo):

```bash
onp-spec licoes list                       # confirmadas, máx 10
onp-spec licoes list --escopo cobranca     # projeto grande: filtre pelo domínio
onp-spec licoes list --query idempotencia  # ou por termo
```

Aplique as lições retornadas ao escrever a spec e o design. Não carregue
candidatas nem quarentenadas como guia — elas não são confiadas.

## ESCREVER — depois do gate, nunca antes

Momento exato: depois que `onp-spec audit --ci` sai 0. O caminho até o 0 ficou
registrado sozinho no histórico de sinais — você não precisa anotar nada
durante a implementação.

1. `onp-spec licoes sugerir` — o motor aponta os sinais que recorreram em
   features distintas e ainda não têm lição. Comece por eles.
2. Para cada lição que valer a pena (**máximo 3 por feature**):

```bash
onp-spec licoes add \
  --sinal  AC_SEM_PROVA \
  --feature entrega-dever \
  --fonte  AC-042 \
  --texto  "Asserte o valor persistido do status, não só a existência do campo" \
  --escopo cobranca/boleto
```

3. Se o motor recusar por falta de lastro, o sinal não aconteceu aqui — a
   lição não existe. Não reformule os argumentos para forçar a entrada.
4. **Caminho limpo (audit passou de primeira, verify sem falha) → nenhuma
   lição.** Isso é o resultado correto, não uma omissão.

### Como frasear (é o que faz a recorrência deduplicar)

O dedup é exato-após-normalização (minúsculas, sem acentos, sem pontuação) —
não é semântico. Duas lições que dizem o mesmo precisam LER igual:

- **A regra geral, não o incidente.** ✔ "Asserte o valor persistido do
  status, não só a existência do campo" · ✘ "O teste da linha 88 estava fraco"
- **Uma frase, tersa e canônica** (o motor recusa acima de 280 caracteres).
- **Uma lição por sinal** — não agrupe.
- `--escopo` com o domínio (aceita hierarquia: `cobranca/boleto`) — é o que
  torna o filtro útil quando o projeto tem dezenas de domínios.

### Quando uma lição confirmada não funcionar

Se você carregou uma confirmada no Especificar e a MESMA falha recorreu mesmo
assim, a orientação não está funcionando:

```bash
onp-spec licoes penalizar --id L-007
```

Duas penalidades movem para quarentena. Use com parcimônia e só em
recorrências reais.

## Escala

Pensada para projetos com muitos domínios e centenas de features:

- o histórico é chaveado por (sinal, feature, ref) — cresce com pontos de
  falha distintos, não com execuções — e é compactado por janela e teto;
- a listagem tem teto fixo: o custo de contexto não cresce com o repositório;
- candidatas que não corroboram dentro da janela são podadas automaticamente.

## Sem node no ambiente

Pule a camada de lições. Não mantenha contabilidade manual de lições —
contabilidade manual é exatamente a falha que esta camada existe para evitar.
Registre em texto, uma vez, que a camada ficou inativa por falta de runtime.
