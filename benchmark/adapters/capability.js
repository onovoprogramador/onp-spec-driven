// Matriz de capacidade para ferramentas SEM validador mecânico de defeitos.
//
// Fato verificado no código-fonte (julho/2026):
//  - spec-kit (github/spec-kit): o CLI `specify` faz init/scaffold/workflows.
//    Os únicos "validate" no código validam opções de init, TOML e estrutura de
//    projeto — não há checagem de defeitos de spec, rastreabilidade req→teste,
//    nem cobertura. Testes são explicitamente OPCIONAIS no template de tasks.
//    => detecção mecânica de defeitos de spec: NENHUMA.
//  - TLC Spec Driven: skill 100% em markdown (instruções para o agente). O único
//    script é lessons.py (renderiza um playbook). O "Verifier" é um sub-agente
//    (LLM), não uma ferramenta determinística. => detecção MECÂNICA: NENHUMA.
//    (Um agente obediente PODE achar alguns defeitos, mas não é mecânico nem
//    roda em CI sem um LLM no loop.)
//
// Por isso estas ferramentas entram no benchmark com detecção mecânica = false
// para toda classe de defeito. Não é um chute: é o que o código-fonte permite.

export const STATIC_TOOLS = {
  'spec-kit': {
    label: 'spec-kit (GitHub)',
    mechanicalValidator: false,
    detects: () => false,
    note: 'CLI de scaffolding; sem validador de defeitos de spec (testes são opcionais no template)',
  },
  tlc: {
    label: 'TLC Spec-Driven',
    mechanicalValidator: false,
    detects: () => false,
    note: 'skill em markdown; Verifier é sub-agente LLM, não ferramenta determinística',
  },
};
