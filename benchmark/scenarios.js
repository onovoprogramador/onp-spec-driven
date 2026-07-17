// Cenários de benchmark — specs REAIS do domínio ONP (curso de programação do
// Vitor Manoel) com defeitos semeados, cada um representando uma falha que
// realmente assola projetos spec-driven.
//
// Cada cenário descreve a MESMA feature de forma neutra; os adaptadores
// materializam no formato de cada ferramenta. A coluna `defectClass` é o eixo
// da comparação: quantas ferramentas detectam mecanicamente cada classe.

// Classes de defeito (o "o que dá errado de verdade")
export const DEFECT_CLASSES = {
  BASELINE_LIMPO: 'spec correta — nenhuma ferramenta pode acusar falso positivo',
  REQ_SEM_TESTE: 'requisito sem nenhum teste que o prove (drift #1 do SDD)',
  TESTE_ORFAO: 'requisito renomeado; teste ficou pra trás apontando pro ID antigo',
  REQ_INCOMPLETO: 'requisito sem comportamento observável (sem Dado/Quando/Então)',
  PRONTO_PREMATURO: 'task marcada concluída sem prova de teste passando',
  SUPOSICAO_SILENCIOSA: 'decisão de produto assumida sem registro explícito',
  PRIVACIDADE_VIOLADA: 'nota de aluno exposta / PII em log — viola a constituição',
  CODIGO_ORFAO: 'arquivo de código que não atende requisito nenhum',
  REF_QUEBRADA: 'task referencia requisito que não existe',
  ID_DUPLICADO: 'dois requisitos com o mesmo identificador',
};

// Feature real 1: inscrição na turma (turma de Agosto do curso ONP)
const inscricaoBase = {
  feature: 'inscricao-turma',
  title: 'Inscrição na turma',
  purpose:
    'Permitir que um novo aluno se inscreva numa turma aberta, respeitando o limite de vagas e registrando o consentimento do responsável quando menor de idade.',
  stories: [
    {
      id: 'US-001',
      title: 'Aluno se inscreve em turma aberta',
      as: 'visitante interessado',
      want: 'me inscrever numa turma com vagas',
      so: 'eu garanta minha vaga no curso',
      acs: [
        {
          id: 'AC-001',
          title: 'Inscrição em turma com vaga',
          given: 'uma turma aberta com vagas disponíveis',
          when: 'o visitante envia nome, e-mail e telefone válidos',
          then: 'a inscrição é registrada e a vaga é decrementada',
        },
        {
          id: 'AC-002',
          title: 'Turma lotada recusa inscrição',
          given: 'uma turma sem vagas',
          when: 'o visitante tenta se inscrever',
          then: 'a inscrição é recusada com mensagem de turma lotada',
        },
      ],
    },
  ],
  assumptions: [
    { id: 'ASM-001', text: 'E-mail é o identificador único do aluno', status: 'confirmada', resolution: 'decidido com o produto' },
  ],
  questions: [],
  constitution: false,
};

// Feature real 2: notas do aluno (sensível a privacidade — LGPD)
const notasBase = {
  feature: 'notas-aluno',
  title: 'Notas do aluno',
  purpose:
    'Mostrar ao aluno as suas próprias notas e correções, registrando quem acessou cada nota, sem jamais expor a nota de um aluno a outro.',
  stories: [
    {
      id: 'US-010',
      title: 'Aluno consulta suas notas',
      as: 'aluno autenticado',
      want: 'ver minhas notas e correções',
      so: 'eu acompanhe meu progresso',
      acs: [
        {
          id: 'AC-010',
          title: 'Aluno vê só as próprias notas',
          given: 'um aluno autenticado com notas registradas',
          when: 'ele abre a página de notas',
          then: 'a resposta contém apenas as notas do próprio aluno',
        },
        {
          id: 'AC-011',
          title: 'Acesso a nota é registrado',
          given: 'um aluno autenticado abrindo suas notas',
          when: 'a nota é lida',
          then: 'um registro de auditoria é gravado com quem, o quê e quando',
        },
      ],
    },
  ],
  assumptions: [
    { id: 'ASM-010', text: 'Professor pode ver notas de toda a turma dele', status: 'confirmada', resolution: 'regra pedagógica' },
  ],
  questions: [],
  constitution: true, // usa preset LGPD/educação
};

// Helper: clona uma feature base para poder semear defeito sem mutar a original
function clone(base) {
  return JSON.parse(JSON.stringify(base));
}

// Constrói os cenários aplicando um defeito sobre uma feature base.
export const SCENARIOS = [
  {
    id: 'S00-baseline',
    defectClass: 'BASELINE_LIMPO',
    feature: clone(inscricaoBase),
    seed: () => {}, // nada — spec correta
  },
  {
    id: 'S01-req-sem-teste',
    defectClass: 'REQ_SEM_TESTE',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // AC-002 não terá teste anotado (o adaptador só gera teste para AC-001)
      f.__semTeste = ['AC-002'];
    },
  },
  {
    id: 'S02-teste-orfao',
    defectClass: 'TESTE_ORFAO',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // renomeia AC-002 → AC-050 na spec, mas o teste continua com @spec:AC-002
      f.stories[0].acs[1].id = 'AC-050';
      f.__testeOrfao = { specId: 'AC-050', testId: 'AC-002' };
    },
  },
  {
    id: 'S03-req-incompleto',
    defectClass: 'REQ_INCOMPLETO',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // AC-002 perde o Então (sem comportamento observável)
      f.stories[0].acs[1].then = '';
      f.__incompleto = ['AC-002'];
    },
  },
  {
    id: 'S04-pronto-prematuro',
    defectClass: 'PRONTO_PREMATURO',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // task concluída, mas o teste do AC falha (sem prova PASS)
      f.__taskConcluidaComFalha = ['AC-001'];
    },
  },
  {
    id: 'S05-suposicao-silenciosa',
    defectClass: 'SUPOSICAO_SILENCIOSA',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // feature "implementada" mas com uma suposição aberta (não resolvida)
      f.status = 'implementada';
      f.assumptions.push({
        id: 'ASM-002',
        text: 'Inscrição não pode ser cancelada pelo próprio aluno',
        status: 'aberta',
        resolution: '—',
      });
    },
  },
  {
    id: 'S06-privacidade-violada',
    defectClass: 'PRIVACIDADE_VIOLADA',
    feature: clone(notasBase),
    seed: (f) => {
      // vaza nota em log — viola P-004 da constituição LGPD
      f.__vazamento = "console.log('nota do aluno', nota);";
    },
  },
  {
    id: 'S07-codigo-orfao',
    defectClass: 'CODIGO_ORFAO',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // um arquivo de código que nenhuma task mapeia
      f.__codigoOrfao = 'src/rastreador-secreto.js';
    },
  },
  {
    id: 'S08-ref-quebrada',
    defectClass: 'REF_QUEBRADA',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // task referencia AC-999 inexistente
      f.__refQuebrada = 'AC-999';
    },
  },
  {
    id: 'S09-id-duplicado',
    defectClass: 'ID_DUPLICADO',
    feature: clone(inscricaoBase),
    seed: (f) => {
      // duplica o ID AC-001 em dois critérios
      f.stories[0].acs[1].id = 'AC-001';
      f.__idDuplicado = 'AC-001';
    },
  },
];

// Aplica os seeds uma vez.
for (const s of SCENARIOS) s.seed(s.feature);
