# Spec: {{TITULO}}

> feature: {{FEATURE}}
> status: rascunho

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - US-xxx = história de usuário · AC-xxx = critério de aceite
    ASM-xxx = suposição · Q-xxx = pergunta em aberto
    São códigos de rastreio: ligam a especificação às tarefas e aos testes.
  - Toda história de usuário precisa de pelo menos um critério de aceite.
  - Todo critério de aceite precisa de Dado/Quando/Então completos.
  - Os códigos são únicos no projeto inteiro (nunca reutilize um número).
  - Suposições e Perguntas em aberto são OBRIGATÓRIAS: se não há nenhuma,
    escreva "Nenhuma." — mas desconfie: quase toda feature esconde uma.
-->

## Contexto

Uma frase sobre o problema que esta feature resolve e para quem.

## Histórias

<!-- História de usuário: quem precisa, o que precisa e por quê. -->

### US-001 — {{TITULO_HISTORIA}}

Como [papel], quero [ação], para que [valor].

<!-- Critério de aceite: o resultado observável que um teste consegue checar.
     Escreva para GENTE: título e Então descrevem o que o usuário vê
     ("a tela avisa X"), não o detalhe técnico ("endpoint retorna 403") —
     o detalhe pode ir entre parênteses. -->

#### AC-001 — [título do critério de aceite]

- **Dado** [estado inicial]
- **Quando** [ação]
- **Então** [resultado esperado e observável]

## Fora de escopo

- O que esta feature explicitamente NÃO faz.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | [o que está sendo assumido em silêncio?] | aberta | — |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-001 | [o que precisa ser decidido pelo dono do produto?] | aberta | — |
