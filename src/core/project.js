// Carrega o estado completo do projeto: specs de todas as features,
// tasks, constituição, anotações nos testes/código e resultados de verify.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { parseSpec } from '../parsers/spec.js';
import { parseTasks } from '../parsers/tasks.js';
import { parseConstitution } from '../parsers/constitution.js';
import { walkFiles, scanAnnotations } from '../parsers/annotations.js';

export function loadProject(config) {
  const { rootDir, specDir } = config;
  const specRoot = path.join(rootDir, specDir);
  const project = {
    config,
    specRoot,
    features: [],
    constitution: null,
    annotations: { specTags: [], principleTags: [] },
    srcFiles: [],
    testFiles: [],
    verifications: {},
    errors: [],
  };

  if (!existsSync(specRoot)) {
    project.errors.push(
      `diretório ${specDir}/ não encontrado — rode \`onp-spec init\` primeiro`
    );
    return project;
  }

  // constituição
  const constitutionPath = path.join(specRoot, 'constituicao.md');
  if (existsSync(constitutionPath)) {
    project.constitution = parseConstitution(readFileSync(constitutionPath, 'utf-8'), {
      file: path.join(specDir, 'constituicao.md'),
    });
  }

  // features
  const featuresRoot = path.join(specRoot, 'features');
  if (existsSync(featuresRoot)) {
    const dirs = readdirSync(featuresRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const name of dirs) {
      const featureDir = path.join(featuresRoot, name);
      const feature = { name, dir: featureDir, spec: null, tasks: null };
      const specPath = path.join(featureDir, 'spec.md');
      if (existsSync(specPath)) {
        feature.spec = parseSpec(readFileSync(specPath, 'utf-8'), {
          file: path.join(specDir, 'features', name, 'spec.md'),
        });
      }
      const tasksPath = path.join(featureDir, 'tasks.md');
      if (existsSync(tasksPath)) {
        feature.tasks = parseTasks(readFileSync(tasksPath, 'utf-8'), {
          file: path.join(specDir, 'features', name, 'tasks.md'),
        });
      }
      project.features.push(feature);
    }
  }

  // verificações (resultado de `onp-spec verify`)
  const verificationDir = path.join(specRoot, 'verification');
  if (existsSync(verificationDir)) {
    for (const entry of readdirSync(verificationDir)) {
      if (!entry.endsWith('.json')) continue;
      try {
        project.verifications[entry.replace(/\.json$/, '')] = JSON.parse(
          readFileSync(path.join(verificationDir, entry), 'utf-8')
        );
      } catch {
        project.errors.push(`verification/${entry} corrompido — rode verify de novo`);
      }
    }
  }

  // arquivos de teste e de código
  project.testFiles = walkFiles(rootDir, {
    includeGlobs: config.testGlobs,
    ignoreGlobs: config.ignoreGlobs,
  });
  project.srcFiles = walkFiles(rootDir, {
    includeGlobs: config.srcGlobs,
    ignoreGlobs: [...config.ignoreGlobs, ...config.testGlobs],
  });
  project.annotations = scanAnnotations(rootDir, [
    ...new Set([...project.testFiles, ...project.srcFiles]),
  ]);

  return project;
}

// Timestamp de modificação mais recente entre os arquivos dados (ms epoch).
export function latestMtime(rootDir, files) {
  let latest = 0;
  for (const rel of files) {
    try {
      const st = statSync(path.join(rootDir, rel));
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } catch {
      // arquivo listado mas inexistente — tratado em outro achado
    }
  }
  return latest;
}
