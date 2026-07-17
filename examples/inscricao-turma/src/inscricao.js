// Implementação da feature inscricao-turma.
// Mapeada por T-001, T-002, T-003 em .spec/features/inscricao-turma/tasks.md.

export function inscrever({ turma, dados }) {
  if (turma.vagas <= 0) {
    return { ok: false, motivo: 'turma lotada' };
  }
  if (dados.idade < 18 && !dados.responsavel) {
    return { ok: false, motivo: 'consentimento do responsável obrigatório' };
  }
  turma.vagas -= 1;
  return { ok: true, inscricao: { email: dados.email, turmaId: turma.id } };
}
