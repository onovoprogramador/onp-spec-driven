// Rótulos legíveis para cada código de achado do audit.
// O código (ex.: AC_SEM_TESTE) é o identificador estável — usado em CI, no
// histórico de sinais e em `licoes add --sinal`. O rótulo é o nome em
// português simples que aparece primeiro para o usuário.

export const FINDING_LABELS = {
  PROJETO_INVALIDO: 'projeto inválido',
  SPEC_AUSENTE: 'especificação ausente',
  SPEC_SEM_US: 'especificação sem história de usuário',
  STATUS_INVALIDO: 'status de especificação inválido',
  FEATURE_DIVERGENTE: 'nome da feature divergente',
  SECAO_AUSENTE: 'seção obrigatória ausente',
  US_SEM_AC: 'história sem critério de aceite',
  AC_INCOMPLETO: 'critério de aceite incompleto',
  AC_FORA_DE_US: 'critério de aceite fora de história',
  AC_SEM_TESTE: 'critério de aceite sem teste',
  AC_SEM_PROVA: 'critério de aceite sem prova',
  AC_SEM_TASK: 'critério de aceite sem tarefa',
  ID_DUPLICADO: 'código de rastreio duplicado',
  ID_CURTO: 'código de rastreio curto demais',
  ASM_ABERTA: 'suposição em aberto',
  ASM_STATUS_INVALIDO: 'status de suposição inválido',
  ASM_ID_INVALIDO: 'suposição sem código válido',
  Q_ABERTA: 'pergunta em aberto',
  Q_STATUS_INVALIDO: 'status de pergunta inválido',
  Q_ID_INVALIDO: 'pergunta sem código válido',
  TASK_CONCLUIDA_SEM_PROVA: 'tarefa concluída sem prova',
  TASK_STATUS_INVALIDO: 'status de tarefa inválido',
  TASK_SEM_STATUS: 'tarefa sem status',
  REF_QUEBRADA: 'referência quebrada',
  REF_MALFORMADA: 'referência malformada',
  ARQUIVO_INEXISTENTE: 'arquivo não existe',
  ARQUIVO_ORFAO: 'código órfão (sem tarefa)',
  TESTE_ORFAO: 'teste órfão (aponta pra critério que sumiu)',
  PROVA_FRACA: 'prova fraca',
  VERIFY_OBSOLETO: 'prova desatualizada',
  CONSTITUICAO_AUSENTE: 'constituição ausente',
  PRINCIPIO_SEM_VERIFICACAO: 'princípio sem verificação',
  PRINCIPIO_VIOLADO: 'princípio violado',
  GLOB_SEM_ARQUIVOS: 'verificação não olha nenhum arquivo',
  NIVEL_INVALIDO: 'nível de princípio inválido',
  VERIFICACAO_MALFORMADA: 'verificação malformada',
};

export function findingLabel(code) {
  return FINDING_LABELS[code] || code.toLowerCase().replace(/_/g, ' ');
}
