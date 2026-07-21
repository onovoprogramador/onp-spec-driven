// Motor de auditoria — responde mecanicamente:
//   "qual requisito NÃO tem teste?"
//   "que teste aponta pra requisito inexistente?"
//   "que código não mapeia pra nenhuma task?"
//   "que princípio DEVE está sem verificação ou violado?"
//
// Cada achado tem código estável (ver ARQUITETURA.md) para uso em CI e docs.

import { existsSync } from 'fs';
import path from 'path';
import { allAcs, SPEC_STATUSES, ASM_STATUSES, Q_STATUSES } from '../parsers/spec.js';
import { grepPattern } from '../parsers/annotations.js';
import { latestMtime } from './project.js';

// severidade base; em modo --ci os códigos em CI_ESCALATES viram erro
const CI_ESCALATES = new Set(['AC_SEM_PROVA', 'VERIFY_OBSOLETO', 'Q_ABERTA', 'AC_SEM_TASK', 'ARQUIVO_ORFAO']);

function finding(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra };
}

export function auditProject(project, { ci = false } = {}) {
  const findings = [];
  const { config } = project;

  for (const err of project.errors) {
    findings.push(finding('PROJETO_INVALIDO', 'erro', err));
  }

  const testFileSet = new Set(project.testFiles);
  const testSpecTags = project.annotations.specTags.filter((t) => testFileSet.has(t.file));
  const testPrincipleTags = project.annotations.principleTags.filter((t) =>
    testFileSet.has(t.file)
  );

  // ---------- unicidade global de IDs ----------
  const seen = new Map(); // id -> {feature, file, line}
  for (const feature of project.features) {
    if (!feature.spec) continue;
    const register = (id, file, line) => {
      if (seen.has(id)) {
        const first = seen.get(id);
        findings.push(
          finding('ID_DUPLICADO', 'erro', `${id} definido em ${first.file} e em ${file}`, {
            feature: feature.name,
            file,
            line,
          })
        );
      } else {
        seen.set(id, { feature: feature.name, file, line });
      }
    };
    for (const story of feature.spec.stories) {
      register(story.id, feature.spec.file, story.line);
      for (const ac of story.acs) register(ac.id, feature.spec.file, ac.line);
    }
    for (const asm of feature.spec.assumptions) register(asm.id, feature.spec.file, asm.line);
    for (const q of feature.spec.questions) register(q.id, feature.spec.file, q.line);
  }

  const knownAcIds = new Set();
  const acById = new Map();
  const knownUsIds = new Set();
  const storyById = new Map();
  for (const feature of project.features) {
    if (!feature.spec) continue;
    for (const story of feature.spec.stories) {
      knownUsIds.add(story.id);
      if (!storyById.has(story.id)) storyById.set(story.id, story);
    }
    for (const ac of allAcs(feature.spec)) {
      knownAcIds.add(ac.id);
      if (!acById.has(ac.id)) acById.set(ac.id, { ac, feature });
    }
  }

  // cobertura de tasks é GLOBAL: IDs são globais, então uma task de qualquer
  // feature pode cobrir um AC de outra (refs cruzadas são válidas)
  const globalCoveredAcs = new Set();
  for (const feature of project.features) {
    if (!feature.tasks) continue;
    for (const task of feature.tasks.tasks) {
      for (const ref of task.refs) {
        if (ref.startsWith('AC-') && knownAcIds.has(ref)) {
          globalCoveredAcs.add(ref);
        } else if (ref.startsWith('US-') && storyById.has(ref)) {
          for (const ac of storyById.get(ref).acs) globalCoveredAcs.add(ac.id);
        }
      }
    }
  }

  // ---------- specs ----------
  for (const feature of project.features) {
    const { name, spec, tasks } = feature;
    if (!spec) {
      findings.push(
        finding('SPEC_AUSENTE', 'erro', `feature ${name} sem spec.md`, { feature: name })
      );
      continue;
    }

    for (const issue of spec.parseIssues) {
      findings.push(
        finding(issue.code, issue.code === 'AC_FORA_DE_US' ? 'erro' : 'aviso', issue.message, {
          feature: name,
          file: spec.file,
          line: issue.line,
        })
      );
    }

    if (spec.status && !SPEC_STATUSES.includes(spec.status)) {
      findings.push(
        finding(
          'STATUS_INVALIDO',
          'aviso',
          `status "${spec.status}" não é um de: ${SPEC_STATUSES.join(', ')}`,
          { feature: name, file: spec.file }
        )
      );
    }

    if (spec.stories.length === 0) {
      findings.push(
        finding('SPEC_SEM_US', 'erro', `especificação sem nenhuma história de usuário (US-xxx)`, {
          feature: name,
          file: spec.file,
        })
      );
    }

    if (spec.feature && spec.feature !== name) {
      findings.push(
        finding(
          'FEATURE_DIVERGENTE',
          'aviso',
          `"> feature: ${spec.feature}" difere do diretório "${name}"`,
          { feature: name, file: spec.file }
        )
      );
    }

    // Suposições e Perguntas são cidadãs de primeira classe: a AUSÊNCIA da
    // seção também é um achado (senão o diferencial vira opcional em silêncio)
    const specMatured = ['pronta', 'em-implementacao', 'implementada', 'auditada'].includes(
      spec.status
    );
    if (spec.sections && !spec.sections.suposicoes) {
      findings.push(
        finding(
          'SECAO_AUSENTE',
          specMatured ? 'erro' : 'aviso',
          `especificação sem seção "## Suposições" — registre as suposições ou escreva "Nenhuma." explicitamente`,
          { feature: name, file: spec.file }
        )
      );
    }
    if (spec.sections && !spec.sections.perguntas) {
      findings.push(
        finding(
          'SECAO_AUSENTE',
          specMatured ? 'erro' : 'aviso',
          `especificação sem seção "## Perguntas em aberto" — registre as perguntas ou escreva "Nenhuma." explicitamente`,
          { feature: name, file: spec.file }
        )
      );
    }

    for (const story of spec.stories) {
      if (story.acs.length === 0) {
        findings.push(
          finding('US_SEM_AC', 'erro', `${story.id} (${story.title}) sem critério de aceite`, {
            feature: name,
            file: spec.file,
            line: story.line,
          })
        );
      }
      for (const ac of story.acs) {
        const missing = [];
        if (ac.given.length === 0) missing.push('Dado');
        if (ac.when.length === 0) missing.push('Quando');
        if (ac.then.length === 0) missing.push('Então');
        if (missing.length) {
          findings.push(
            finding(
              'AC_INCOMPLETO',
              'erro',
              `${ac.id} (${ac.title}) sem cláusula: ${missing.join(', ')}`,
              { feature: name, file: spec.file, line: ac.line }
            )
          );
        }
      }
    }

    // suposições e perguntas
    const implemented = ['implementada', 'auditada'].includes(spec.status);
    const inProgress = ['em-implementacao', 'implementada', 'auditada'].includes(spec.status);

    for (const asm of spec.assumptions) {
      if (asm.status && !ASM_STATUSES.includes(asm.status)) {
        findings.push(
          finding(
            'ASM_STATUS_INVALIDO',
            'aviso',
            `${asm.id} com status "${asm.status}" (use: ${ASM_STATUSES.join(', ')})`,
            { feature: name, file: spec.file, line: asm.line }
          )
        );
      }
      if (implemented && asm.status === 'aberta') {
        findings.push(
          finding(
            'ASM_ABERTA',
            'erro',
            `${asm.id} continua aberta com a feature "${spec.status}": "${asm.text}" — confirme ou invalide antes de declarar pronto`,
            { feature: name, file: spec.file, line: asm.line }
          )
        );
      }
    }

    for (const q of spec.questions) {
      if (q.status && !Q_STATUSES.includes(q.status)) {
        findings.push(
          finding(
            'Q_STATUS_INVALIDO',
            'aviso',
            `${q.id} com status "${q.status}" (use: ${Q_STATUSES.join(', ')})`,
            { feature: name, file: spec.file, line: q.line }
          )
        );
      }
      if (inProgress && q.status === 'aberta') {
        findings.push(
          finding(
            'Q_ABERTA',
            'aviso',
            `${q.id} em aberto durante implementação: "${q.text}"`,
            { feature: name, file: spec.file, line: q.line }
          )
        );
      }
    }

    // ---------- tasks ----------
    const specAcIds = new Set(allAcs(spec).map((a) => a.id));

    if (tasks) {
      for (const issue of tasks.parseIssues) {
        findings.push(
          finding(issue.code, issue.code === 'TASK_STATUS_INVALIDO' ? 'erro' : 'aviso', issue.message, {
            feature: name,
            file: tasks.file,
            line: issue.line,
          })
        );
      }

      for (const task of tasks.tasks) {
        for (const ref of task.refs) {
          // IDs são globais: uma ref é válida se existe em QUALQUER spec
          const ok = ref.startsWith('US-') ? knownUsIds.has(ref) : knownAcIds.has(ref);
          if (!ok) {
            findings.push(
              finding(
                'REF_QUEBRADA',
                'erro',
                `a tarefa ${task.id} referencia ${ref}, que não existe em nenhuma especificação`,
                { feature: name, file: tasks.file, line: task.line }
              )
            );
          }
        }

        for (const relFile of task.files) {
          if (!existsSync(path.join(config.rootDir, relFile))) {
            findings.push(
              finding(
                'ARQUIVO_INEXISTENTE',
                task.status === 'concluida' ? 'erro' : 'aviso',
                `a tarefa ${task.id} mapeia ${relFile}, que não existe${task.status === 'concluida' ? ' (tarefa concluída!)' : ''}`,
                { feature: name, file: tasks.file, line: task.line }
              )
            );
          }
        }

        if (task.status === 'concluida') {
          const taskAcs = task.refs.filter((r) => r.startsWith('AC-') && knownAcIds.has(r));
          for (const acId of taskAcs) {
            // a prova mora na feature DONA do AC (refs podem ser cruzadas)
            const owner = acById.get(acId);
            const verification = owner ? project.verifications[owner.feature.name] || null : null;
            const proof = verification?.results?.[acId];
            if (!proof || proof.status !== 'pass') {
              const why = proof?.status === 'skip' ? ' (o teste foi PULADO — skip não é prova)' : '';
              findings.push(
                finding(
                  'TASK_CONCLUIDA_SEM_PROVA',
                  'erro',
                  `a tarefa ${task.id} está [concluida] mas o critério ${acId} não tem prova PASS do verify${why}`,
                  { feature: name, file: tasks.file, line: task.line }
                )
              );
            }
          }
        }
      }

      for (const ac of allAcs(spec)) {
        if (!globalCoveredAcs.has(ac.id)) {
          findings.push(
            finding('AC_SEM_TASK', 'aviso', `${ac.id} (${ac.title}) não é coberto por nenhuma tarefa`, {
              feature: name,
              file: tasks.file,
            })
          );
        }
      }
    }

    // ---------- rastreabilidade AC → teste ----------
    for (const ac of allAcs(spec)) {
      const tags = testSpecTags.filter((t) => t.acId === ac.id);
      if (tags.length === 0) {
        findings.push(
          finding(
            'AC_SEM_TESTE',
            'erro',
            `${ac.id} (${ac.title}) não tem nenhum teste anotado com @spec:${ac.id}`,
            { feature: name, file: spec.file, line: ac.line }
          )
        );
      } else {
        const verification = project.verifications[name] || null;
        const proof = verification?.results?.[ac.id];
        if (!proof) {
          findings.push(
            finding(
              'AC_SEM_PROVA',
              'aviso',
              `${ac.id} tem teste (${tags[0].file}:${tags[0].line}) mas nunca foi provado — rode \`onp-spec verify ${name}\``,
              { feature: name, file: tags[0].file, line: tags[0].line }
            )
          );
        } else if (proof.status !== 'pass') {
          const msg =
            proof.status === 'skip'
              ? `${ac.id}: o teste foi PULADO na última verificação (${proof.testName || tags[0].file}) — skip não é prova`
              : `${ac.id} FALHOU na última verificação (${proof.testName || tags[0].file})`;
          findings.push(
            finding('AC_SEM_PROVA', 'erro', msg, {
              feature: name,
              file: tags[0].file,
              line: tags[0].line,
            })
          );
        } else if (proof.method === 'exitcode') {
          findings.push(
            finding(
              'PROVA_FRACA',
              'aviso',
              `${ac.id} provado apenas pelo exit code global (reporter "exitcode") — sem granularidade por teste; prefira tap/vitest-json/jest-json`,
              { feature: name, file: tags[0]?.file, line: tags[0]?.line }
            )
          );
        }
      }
    }

    // verify obsoleto?
    const verification = project.verifications[name] || null;
    if (verification?.timestamp) {
      const codeMtime = latestMtime(config.rootDir, [
        ...project.srcFiles,
        ...project.testFiles,
      ]);
      if (codeMtime > Date.parse(verification.timestamp)) {
        findings.push(
          finding(
            'VERIFY_OBSOLETO',
            'aviso',
            `código/testes mudaram depois do último verify de ${name} — rode \`onp-spec verify ${name}\` de novo`,
            { feature: name }
          )
        );
      }
    }
  }

  // ---------- testes órfãos (drift clássico) ----------
  const seenOrphan = new Set();
  for (const tag of project.annotations.specTags) {
    if (!knownAcIds.has(tag.acId)) {
      const key = `${tag.acId}:${tag.file}`;
      if (seenOrphan.has(key)) continue;
      seenOrphan.add(key);
      findings.push(
        finding(
          'TESTE_ORFAO',
          'erro',
          `teste anotado com @spec:${tag.acId}, mas esse critério de aceite não existe em nenhuma especificação (a especificação mudou e o teste ficou pra trás?)`,
          { file: tag.file, line: tag.line }
        )
      );
    }
  }

  // ---------- código órfão ----------
  const anyTasks = project.features.some((f) => f.tasks && f.tasks.tasks.length > 0);
  if (anyTasks) {
    const claimed = new Set();
    for (const feature of project.features) {
      if (!feature.tasks) continue;
      for (const task of feature.tasks.tasks) {
        for (const f of task.files) claimed.add(f.split('\\').join('/'));
      }
    }
    for (const src of project.srcFiles) {
      if (!claimed.has(src)) {
        findings.push(
          finding(
            'ARQUIVO_ORFAO',
            'aviso',
            `${src} não é mapeado por nenhuma tarefa — que requisito esse código atende?`,
            { file: src }
          )
        );
      }
    }
  }

  // ---------- constituição ----------
  if (!project.constitution) {
    findings.push(
      finding(
        'CONSTITUICAO_AUSENTE',
        'aviso',
        `sem ${config.specDir}/constituicao.md — rode \`onp-spec init\` para criar (preset LGPD/educação disponível)`
      )
    );
  } else {
    const constitution = project.constitution;
    for (const issue of constitution.parseIssues) {
      findings.push(
        finding(issue.code, 'erro', issue.message, { file: constitution.file, line: issue.line })
      );
    }
    for (const p of constitution.principles) {
      if (p.level === 'DEVE' && p.checks.length === 0) {
        findings.push(
          finding(
            'PRINCIPIO_SEM_VERIFICACAO',
            'erro',
            `${p.id} [DEVE] "${p.title}" não tem nenhuma verificação executável`,
            { file: constitution.file, line: p.line }
          )
        );
      }
      for (const check of p.checks) {
        if (check.kind === 'gate') {
          // satisfeita pelo próprio mecanismo do audit (AC_SEM_TESTE,
          // AC_SEM_PROVA, TASK_CONCLUIDA_SEM_PROVA...) — nada a verificar aqui
          continue;
        }
        if (check.kind === 'teste') {
          const tags = testPrincipleTags.filter((t) => t.principleId === check.principleTag);
          if (tags.length === 0) {
            findings.push(
              finding(
                'PRINCIPIO_VIOLADO',
                p.level === 'DEVE' ? 'erro' : 'aviso',
                `${p.id} exige teste @principle:${check.principleTag} e nenhum teste tem essa tag`,
                { file: constitution.file, line: check.line }
              )
            );
          }
        } else if (check.kind === 'proibido') {
          const { error, hits, files } = grepPattern(
            config.rootDir,
            check.pattern,
            check.glob,
            config.ignoreGlobs
          );
          if (files.length === 0) {
            findings.push(
              finding(
                'GLOB_SEM_ARQUIVOS',
                'aviso',
                `${p.id}: o glob \`${check.glob}\` não casa nenhum arquivo — verificação inerte (typo no glob?)`,
                { file: constitution.file, line: check.line }
              )
            );
          }
          if (error) {
            findings.push(
              finding('VERIFICACAO_MALFORMADA', 'erro', `${p.id}: ${error}`, {
                file: constitution.file,
                line: check.line,
              })
            );
          }
          for (const hit of hits) {
            findings.push(
              finding(
                'PRINCIPIO_VIOLADO',
                p.level === 'DEVE' ? 'erro' : 'aviso',
                `${p.id} "${p.title}": padrão proibido \`${check.pattern}\` encontrado`,
                { file: hit.file, line: hit.line, principle: p.id }
              )
            );
          }
        } else if (check.kind === 'obrigatorio') {
          const { error, hits, files } = grepPattern(
            config.rootDir,
            check.pattern,
            check.glob,
            config.ignoreGlobs
          );
          if (files.length === 0) {
            findings.push(
              finding(
                'GLOB_SEM_ARQUIVOS',
                'aviso',
                `${p.id}: o glob \`${check.glob}\` não casa nenhum arquivo — verificação inerte (typo no glob?)`,
                { file: constitution.file, line: check.line }
              )
            );
          }
          if (error) {
            findings.push(
              finding('VERIFICACAO_MALFORMADA', 'erro', `${p.id}: ${error}`, {
                file: constitution.file,
                line: check.line,
              })
            );
          } else if (files.length > 0 && hits.length === 0) {
            findings.push(
              finding(
                'PRINCIPIO_VIOLADO',
                p.level === 'DEVE' ? 'erro' : 'aviso',
                `${p.id} "${p.title}": padrão obrigatório \`${check.pattern}\` não encontrado em \`${check.glob}\``,
                { file: constitution.file, line: check.line, principle: p.id }
              )
            );
          }
        }
      }
    }
  }

  // ---------- resolve severidade final ----------
  if (ci) {
    for (const f of findings) {
      if (CI_ESCALATES.has(f.code) && f.severity === 'aviso') f.severity = 'erro';
    }
  }

  const errors = findings.filter((f) => f.severity === 'erro');
  const warnings = findings.filter((f) => f.severity === 'aviso');

  const totalAcs = project.features.reduce(
    (n, f) => n + (f.spec ? allAcs(f.spec).length : 0),
    0
  );
  const acsWithTest = new Set(
    testSpecTags.filter((t) => knownAcIds.has(t.acId)).map((t) => t.acId)
  ).size;
  const acsProven = project.features.reduce((n, f) => {
    const v = project.verifications[f.name];
    if (!v?.results || !f.spec) return n;
    return (
      n + allAcs(f.spec).filter((ac) => v.results[ac.id]?.status === 'pass').length
    );
  }, 0);

  return {
    findings,
    ok: errors.length === 0,
    exitCode: errors.length === 0 ? 0 : 1,
    stats: {
      features: project.features.length,
      stories: project.features.reduce((n, f) => n + (f.spec?.stories.length || 0), 0),
      acs: totalAcs,
      acsWithTest,
      acsProven,
      assumptionsOpen: project.features.reduce(
        (n, f) => n + (f.spec?.assumptions.filter((a) => a.status === 'aberta').length || 0),
        0
      ),
      questionsOpen: project.features.reduce(
        (n, f) => n + (f.spec?.questions.filter((q) => q.status === 'aberta').length || 0),
        0
      ),
      principles: project.constitution?.principles.length || 0,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
