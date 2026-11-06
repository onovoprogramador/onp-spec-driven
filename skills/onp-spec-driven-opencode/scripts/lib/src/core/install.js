// Instalação aditiva: nenhum arquivo de um destino existente é regravado.
import { lstatSync, statSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function pathExists(filename) {
  try { lstatSync(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function metadata(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('SKILL.md precisa de frontmatter YAML.');
  const unquote = (value) => value?.trim().replace(/^(['"])(.*)\1$/, '$2');
  const name = unquote(match[1].match(/^name:\s*(.+)$/m)?.[1]);
  const block = match[1].match(/^metadata:\s*\r?\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1];
  const version = unquote(block?.match(/^[ \t]+version:\s*(.+)$/m)?.[1]);
  if (!name || !version) throw new Error('SKILL.md precisa de name e metadata.version.');
  return { name, version };
}

function withName(content, name) {
  return content.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/, (_, start, frontmatter, end) =>
    `${start}${frontmatter.replace(/^name:[^\r\n]*/m, `name: ${name}`)}${end}`);
}

function sourceTree(root) {
  const entries = [];
  function visit(dir, prefix = '') {
    for (const item of readdirSync(dir).sort()) {
      const rel = path.join(prefix, item);
      const filename = path.join(root, rel);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) {
        let linkType;
        if (process.platform === 'win32') {
          try { linkType = statSync(filename).isDirectory() ? 'junction' : 'file'; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        entries.push({ rel, kind: 'link', target: readlinkSync(filename), linkType });
      }
      else if (stat.isDirectory()) { entries.push({ rel, kind: 'directory' }); visit(filename, rel); }
      else if (stat.isFile()) entries.push({ rel, kind: 'file', bytes: readFileSync(filename), mode: stat.mode & 0o777 });
      else throw new Error(`Tipo de arquivo não suportado na skill: ${rel}`);
    }
  }
  visit(root);
  return entries;
}

function expectedTree(entries, skillContent, name, rename) {
  if (!rename) return entries;
  return entries.map((entry) => entry.rel === 'SKILL.md'
    ? { rel: entry.rel, kind: 'file', bytes: Buffer.from(withName(skillContent, name)), mode: entry.mode ?? 0o644 }
    : entry);
}

function matches(destination, expected) {
  if (!pathExists(destination) || !lstatSync(destination).isDirectory()) return false;
  for (const entry of expected) {
    const filename = path.join(destination, entry.rel);
    if (!pathExists(filename)) return false;
    const actual = lstatSync(filename);
    if (entry.kind === 'directory') { if (!actual.isDirectory()) return false; }
    else if (entry.kind === 'link') {
      if (!actual.isSymbolicLink() || readlinkSync(filename) !== entry.target) return false;
    } else if (!actual.isFile() || !readFileSync(filename).equals(entry.bytes)) return false;
  }
  // Arquivos adicionais do usuário não mudam a distribuição esperada.
  return true;
}

function createExclusive(destination, entries) {
  try { mkdirSync(destination); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  for (const entry of entries) {
    const filename = path.join(destination, entry.rel);
    if (entry.kind === 'directory') mkdirSync(filename);
    else if (entry.kind === 'link') symlinkSync(entry.target, filename, entry.linkType);
    else writeFileSync(filename, entry.bytes, { flag: 'wx', mode: entry.mode });
  }
  return true;
}

/** Reutiliza uma distribuição igual; atualizações/customizações coexistem. */
export function installSkill(sourceDir, canonicalDest, { agent, versioned = false } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(agent || '')) throw new Error('Informe um agent válido para instalar a skill.');
  const source = realpathSync(sourceDir);
  if (!lstatSync(source).isDirectory()) throw new Error('A origem da skill precisa ser um diretório.');
  const canonical = path.resolve(canonicalDest);
  const skillContent = readFileSync(path.join(source, 'SKILL.md'), 'utf8');
  const info = metadata(skillContent);
  const entries = sourceTree(source);
  const preserved = pathExists(canonical);
  if (!versioned) {
    // O motor pode estar sendo executado da própria instalação, inclusive
    // quando o usuário optou por manter um symlink para a origem.
    let sameLocation = false;
    if (preserved) {
      try { sameLocation = realpathSync(canonical) === source; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (sameLocation) return { destination: canonical, preserved, reused: true, name: info.name };
    // O motor embarcado pode partir de uma instalação versionada. O nome
    // da cópia nova precisa corresponder à pasta canônica do outro projeto;
    // a origem e qualquer instalação existente continuam intocadas.
    const name = path.basename(canonical);
    const canonicalEntries = expectedTree(entries, skillContent, name, info.name !== name);
    if (matches(canonical, canonicalEntries)) return { destination: canonical, preserved, reused: true, name };
    if (!preserved) {
      mkdirSync(path.dirname(canonical), { recursive: true });
      if (createExclusive(canonical, canonicalEntries)) return { destination: canonical, preserved: false, reused: false, name };
      if (matches(canonical, canonicalEntries)) return { destination: canonical, preserved: true, reused: true, name };
    }
  }
  const version = info.version.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!version) throw new Error('metadata.version não pode ser normalizada para um nome de skill.');
  const base = `onp-spec-driven-${agent}-v${version}`;
  mkdirSync(path.dirname(canonical), { recursive: true });
  for (let number = 1; ; number++) {
    const name = number === 1 ? base : `${base}-${number}`;
    if (name.length > 64) throw new Error('O nome da skill versionada excede 64 caracteres.');
    const destination = path.join(path.dirname(canonical), name);
    const expected = expectedTree(entries, skillContent, name, true);
    if (matches(destination, expected)) return { destination, preserved: pathExists(canonical), reused: true, name };
    if (pathExists(destination)) continue;
    if (createExclusive(destination, expected)) return { destination, preserved: pathExists(canonical), reused: false, name };
    // Outro instalador ocupou o nome entre a consulta e o mkdir exclusivo.
    if (matches(destination, expected)) return { destination, preserved: pathExists(canonical), reused: true, name };
  }
}
