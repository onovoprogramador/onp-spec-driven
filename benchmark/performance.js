// Reproducible synthetic comparison against the pre-0.10 grouping/walk logic.
// No network, model calls or external packages. Run: npm run bench:performance
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { syncBuiltinESMExports } from 'node:module';
import { montarPlano } from '../src/core/plano.js';
import { walkFiles } from '../src/parsers/annotations.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { globToRegExp, anyGlobMatch } from '../src/util/text.js';

const iterations = 7;
function stats(samples) {
  const ordered = [...samples].sort((a, b) => a - b);
  return { medianMs: ordered[Math.floor(ordered.length / 2)], minMs: ordered[0], maxMs: ordered.at(-1), samplesMs: samples };
}
function measure(fn) {
  fn(); // one unreported warm-up; timed samples retain JIT/GC variability
  const samples = [];
  let value;
  for (let i = 0; i < iterations; i++) { const start = performance.now(); value = fn(); samples.push(performance.now() - start); }
  return { ...stats(samples), value };
}
function baselineGroups(tasks) {
  const groups = []; let comparisons = 0;
  for (const task of tasks) {
    const owners = groups.filter((group) => task.files.some((file) => { comparisons++; return group.fileSet.has(file); }));
    if (!owners.length) groups.push({ tasks: [task], fileSet: new Set(task.files) });
    else {
      const target = owners[0];
      for (const other of owners.slice(1)) {
        target.tasks.push(...other.tasks);
        for (const file of other.fileSet) target.fileSet.add(file);
        groups.splice(groups.indexOf(other), 1);
      }
      target.tasks.push(task);
      for (const file of task.files) target.fileSet.add(file);
    }
  }
  return { groups, comparisons };
}
const canonical = (groups) => groups.map((group) => group.tasks.map((task) => task.id).sort().join(',')).sort();
function taskSet(count, mode) {
  return Array.from({ length: count }, (_, i) => ({
    id: `T-${String(i + 1).padStart(3, '0')}`, title: `Task ${i + 1}`, line: i,
    status: 'pendente', refs: [], model: null, esforco: null,
    files: mode === 'independent' ? [`src/file-${i}.js`] : [`src/group-${Math.floor(i / 10)}.js`, `src/file-${i}.js`],
  }));
}
const grouping = [];
for (const mode of ['independent', 'shared-in-groups-of-10']) {
  for (const count of [500, 2000, 6000]) {
    const tasks = taskSet(count, mode);
    const project = { config: { ...DEFAULT_CONFIG, rootDir: path.resolve('synthetic-project') }, features: [{ name: 'benchmark', tasks: { tasks }, spec: { stories: [] } }] };
    const baseline = measure(() => baselineGroups(tasks));
    // This deliberately measures MORE work on the new side (the complete plan),
    // so the result must not be described as isolated algorithm timing.
    const current = measure(() => montarPlano(project, 'benchmark', { runId: 'benchmark', now: new Date(0) }));
    assert.equal(current.value.erro, undefined);
    assert.deepEqual(canonical(current.value.faixas), canonical(baseline.value.groups));
    const { value: oldValue, ...oldTiming } = baseline;
    const { value: newValue, ...newTiming } = current;
    grouping.push({ mode, tasks: count, groups: newValue.faixas.length, baselineComparisons: oldValue.comparisons,
      indexedFileReferences: tasks.reduce((sum, task) => sum + task.files.length, 0),
      baselineGrouping: oldTiming, currentFullPlan: newTiming,
      medianRatio: oldTiming.medianMs / newTiming.medianMs });
  }
}

function staticDirOf(glob) {
  const wildcard = glob.search(/[*?]/);
  const prefix = wildcard === -1 ? glob : glob.slice(0, wildcard);
  const slash = prefix.lastIndexOf('/');
  return slash === -1 ? '' : prefix.slice(0, slash);
}
function baselineWalk(root, { includeGlobs, ignoreGlobs }) {
  const include = includeGlobs.map(globToRegExp), ignore = ignoreGlobs.map(globToRegExp), found = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name), rel = path.relative(root, full).split(path.sep).join('/');
      if (anyGlobMatch(rel, ignore)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && anyGlobMatch(rel, include)) found.add(rel);
    }
  }
  for (const dir of new Set(includeGlobs.map((glob) => path.resolve(root, staticDirOf(glob))))) walk(dir);
  return [...found].sort();
}
function countReads(fn) {
  const original = fs.readdirSync; let calls = 0;
  fs.readdirSync = (...args) => { calls++; return original(...args); };
  syncBuiltinESMExports();
  try { return { calls: (fn(), calls) }; }
  finally { fs.readdirSync = original; syncBuiltinESMExports(); }
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'onp-performance-'));
let walk;
try {
  for (let area = 0; area < 20; area++) {
    for (let section = 0; section < 3; section++) {
      const dir = path.join(temp, 'src', `area-${area}`, `part-${section}`);
      fs.mkdirSync(dir, { recursive: true });
      for (let file = 0; file < 12; file++) fs.writeFileSync(path.join(dir, `${file}.js`), 'export const value = 1;\n');
    }
  }
  const options = { includeGlobs: ['src/**', ...Array.from({ length: 10 }, (_, i) => `src/area-${i}/**`)], ignoreGlobs: [] };
  const baseline = measure(() => baselineWalk(temp, options));
  const current = measure(() => walkFiles(temp, options));
  assert.deepEqual(current.value, baseline.value);
  const { value: files, ...baselineTiming } = baseline;
  const { value: _ignored, ...currentTiming } = current;
  walk = { files: files.length, includeGlobs: options.includeGlobs,
    baselineDirectoryReads: countReads(() => baselineWalk(temp, options)).calls,
    currentDirectoryReads: countReads(() => walkFiles(temp, options)).calls,
    baseline: baselineTiming, current: currentTiming,
    medianRatio: baselineTiming.medianMs / currentTiming.medianMs };
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

const report = { measuredAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
  node: process.version, cpu: os.cpus()[0]?.model || 'unknown', iterations,
  method: '7 timed repetitions after one warm-up; median/min/max, no inference or network. Baseline grouping only vs current complete plan; filesystem same data and output, warm caches. Ratios describe this synthetic workload, not user-product latency.',
  grouping, walk };
const args = process.argv.slice(2);
const output = args.indexOf('--json');
if (output !== -1) {
  if (!args[output + 1]) throw new Error('--json exige um caminho');
  const file = path.resolve(args[output + 1]); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
