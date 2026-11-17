import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const docsRoot = join(repoRoot, 'docs');
const readmePath = join(repoRoot, 'README.md');
const agentsPath = join(repoRoot, 'AGENTS.md');
const docsAgentsPath = join(docsRoot, 'AGENTS.md');

const relativePath = (file: string): string => relative(repoRoot, file).split(sep).join('/');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/**
 * Returns the text with fenced code blocks blanked, so link and heading scans
 * ignore examples. Every code fence toggles the state, so an unclosed fence
 * hides the rest of the file instead of producing false positives.
 */
function withoutFences(text: string): string {
  let fenced = false;
  return text
    .split('\n')
    .map(line => {
      if (/^\s*(?:\`\`\`|~~~)/.test(line)) {
        fenced = !fenced;
        return '';
      }
      return fenced ? '' : line;
    })
    .join('\n');
}

interface DocumentLink {
  target: string;
  line: number;
}

const UNDEFINED_REFERENCE = '\u0000reference:';
const CONSTRAINT = /(?:[<>]=?|=)\s*\d+\.\d+\.\d+(?:-rc\.\d+|(-\d+))?(?:\s+[<>]=?\s*\d+\.\d+\.\d+(?:-rc\.\d+|(-\d+))?)?/;
const PROSE_CONSTRAINT = /\b(DSH|Node(?:\.js)?)\b[^\n]{0,40}?((?:[<>]=?|=)\s*\d+\.\d+\.\d+(?:-rc\.\d+|(-\d+))?(?:\s+[<>]=?\s*\d+\.\d+\.\d+(?:-rc\.\d+|(-\d+))?)?)/g;

/** Drops inline code spans, so a Markdown example in backticks is not a link. */
function withoutInlineCode(text: string): string {
  return text.replace(/`[^`\n]*`/g, '');
}

function documentLinks(text: string): DocumentLink[] {
  const links: DocumentLink[] = [];
  const lines = withoutInlineCode(withoutFences(text)).split('\n');
  const definitions = new Map<string, DocumentLink>();
  const definitionPattern = /^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(].*)?$/;
  lines.forEach((line, index) => {
    const definition = definitionPattern.exec(line);
    if (definition === null) return;
    const entry = { target: definition[2] ?? '', line: index + 1 };
    definitions.set((definition[1] ?? '').trim().toLowerCase(), entry);
    links.push(entry);
  });
  lines.forEach((line, index) => {
    const inline = /!?\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))?(?:\s+"[^"]*"|\s+'[^']*')?\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = inline.exec(line)) !== null) {
      links.push({ target: match[2] ?? match[3] ?? '', line: index + 1 });
    }
    const reference = /!?\[([^\]]*)\]\[([^\]]*)\]/g;
    while ((match = reference.exec(line)) !== null) {
      const label = (match[2] || match[1] || '').trim().toLowerCase();
      const definition = definitions.get(label);
      links.push(definition === undefined
        ? { target: UNDEFINED_REFERENCE + label, line: index + 1 }
        : { target: definition.target, line: index + 1 });
    }
  });
  return links;
}

function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function headingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of withoutFences(text).split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match === null) continue;
    const base = headingSlug(match[1] ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : base + '-' + String(count));
  }
  return anchors;
}

/** A dotted version, excluding numerals inside an IP address or a longer dotted run. */
const VERSION_TOKEN = /(?<![\d.])\d+\.\d+\.\d+(?:-rc\.\d+)?(?!\.?\d)/g;

const docsFiles = walk(docsRoot)
  .filter(file => file.endsWith('.md'))
  .sort();
const maintainedFiles = [readmePath, agentsPath, ...docsFiles].sort();
const indexFile = join(docsRoot, 'README.md');

function isExternal(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function checkAnchor(target: string, fragment: string, source: string, line: number, errors: string[]): void {
  if (fragment === '') return;
  const decoded = decodeURIComponent(fragment);
  const anchors = headingAnchors(readFileSync(target, 'utf8'));
  if (!anchors.has(decoded)) {
    errors.push(relativePath(source) + ':' + String(line) + ' links to missing anchor #' + decoded + ' in ' + relativePath(target));
  }
}

describe('maintained documentation', () => {
  it('resolves every local link and heading anchor', () => {
    const errors: string[] = [];
    for (const file of maintainedFiles) {
      for (const link of documentLinks(readFileSync(file, 'utf8'))) {
        const target = link.target.trim();
        if (target.startsWith(UNDEFINED_REFERENCE)) {
          errors.push(relativePath(file) + ':' + String(link.line) + ' uses undefined link reference ' + target.slice(UNDEFINED_REFERENCE.length));
          continue;
        }
        if (target === '' || isExternal(target)) continue;
        if (target.startsWith('#')) {
          checkAnchor(file, target.slice(1), file, link.line, errors);
          continue;
        }
        const hashIndex = target.indexOf('#');
        const pathPart = decodeURIComponent(hashIndex === -1 ? target : target.slice(0, hashIndex));
        const fragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
        if (pathPart === '') {
          checkAnchor(file, fragment, file, link.line, errors);
          continue;
        }
        const targetPath = resolve(dirname(file), pathPart);
        if (!existsSync(targetPath)) {
          errors.push(relativePath(file) + ':' + String(link.line) + ' links to missing ' + target);
          continue;
        }
        if (fragment !== '' && targetPath.endsWith('.md')) {
          checkAnchor(targetPath, fragment, file, link.line, errors);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('lists every maintained document in the index', () => {
    const errors: string[] = [];
    const indexed = new Set<string>();
    for (const link of documentLinks(readFileSync(indexFile, 'utf8'))) {
      const target = link.target.trim();
      if (target === '' || target.startsWith(UNDEFINED_REFERENCE) || isExternal(target)) continue;
      const pathPart = decodeURIComponent(target.split('#')[0] ?? '');
      if (pathPart === '') continue;
      indexed.add(relativePath(resolve(docsRoot, pathPart)));
    }
    for (const file of docsFiles) {
      const path = relativePath(file);
      if (path === 'docs/README.md') continue;
      if (!indexed.has(path)) errors.push('docs/README.md does not list ' + path);
    }
    for (const entry of indexed) {
      if (!existsSync(join(repoRoot, entry))) errors.push('docs/README.md lists missing ' + entry);
    }
    expect(errors).toEqual([]);
  });

  it('links every user guide from the README feature map', () => {
    const linked = new Set<string>();
    for (const link of documentLinks(readFileSync(readmePath, 'utf8'))) {
      const target = link.target.trim();
      if (target === '' || target.startsWith(UNDEFINED_REFERENCE) || isExternal(target) || target.startsWith('#')) continue;
      linked.add(relativePath(resolve(repoRoot, decodeURIComponent(target.split('#')[0] ?? ''))));
    }
    const missing = docsFiles
      .map(relativePath)
      .filter(path => path.startsWith('docs/user/') && !linked.has(path));
    expect(missing).toEqual([]);
  });

  it('keeps machine-local paths and acceptance-run URLs out of maintained documents', () => {
    const absolute = [
      /(?:^|[^\w./-])(\/(?:Users|home|Applications)\/[^\s)\`'"<>]+)/g,
      /(?:^|[^\w])([A-Za-z]:\\[^\s)\`'"<>]+)/g,
    ];
    const productHome = [/^~\/\.dsh(?:\/|$)/, /^~\/\.dsh-kanban(?:\/|$)/, /^~\/Library\/CloudStorage(?:\/|$)/];
    const errors: string[] = [];
    for (const file of maintainedFiles) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of absolute) {
        for (const match of text.matchAll(pattern)) {
          errors.push(relativePath(file) + ' contains machine path ' + (match[1] ?? match[0]));
        }
      }
      for (const match of text.matchAll(/(?:^|[\s(\`'"])(~\/[^\s)\`'"<>]+)/g)) {
        const value = match[1] ?? '';
        if (!productHome.some(pattern => pattern.test(value))) errors.push(relativePath(file) + ' contains home path ' + value);
      }
      for (const match of text.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::(\d+))?/gi)) {
        if (match[1] !== '9230') errors.push(relativePath(file) + ' contains acceptance-run URL ' + match[0]);
      }
    }
    expect(errors).toEqual([]);
  });

  it('records no test count, run timestamp, or build fingerprint as documentation', () => {
    const patterns = [
      { name: 'run timestamp', pattern: /\b\d{1,2}:\d{2}:\d{2}\b/ },
      { name: 'calendar date', pattern: /\b20\d{2}-\d{2}-\d{2}\b/ },
      { name: 'test count', pattern: /\b\d[\d,]*\s+(?:tests?|suites?|test files)\b/i },
      { name: 'test tally', pattern: /\b\d[\d,]*\s+(?:passed|skipped)\b/i },
      { name: 'labelled test files', pattern: /\bTest files\s*[:=]\s*\d/i },
      { name: 'labelled test tally', pattern: /\b(?:passed|skipped|failed|tests?)\s*[:=]\s*\d/i },
      { name: 'build fingerprint', pattern: /\b[0-9a-f]{40,}\b/ },
    ];
    const errors: string[] = [];
    for (const file of maintainedFiles) {
      const text = readFileSync(file, 'utf8');
      for (const { name, pattern } of patterns) {
        const match = pattern.exec(text);
        if (match !== null) errors.push(relativePath(file) + ' records a ' + name + ': ' + match[0]);
      }
    }
    expect(errors).toEqual([]);
  });

  it('commits no verification evidence artifact', () => {
    const ignored = new Set(['node_modules', '.git', '.verification', 'lib', 'dist', 'coverage', 'test-results', 'playwright-report', 'openspec', '.agents']);
    const evidence = [/(?:^|[-_])review\.md$/i, /^scenario-evidence\.md$/i, /^verification-runs\.json$/i, /^verification-preliminary\.md$/i];
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (relativePath(path) === 'docs/evidence') offenders.push('docs/evidence/ directory');
          visit(path);
          continue;
        }
        if (evidence.some(pattern => pattern.test(entry.name))) offenders.push(relativePath(path));
      }
    };
    visit(repoRoot);
    expect(offenders).toEqual([]);
  });

  it('states versions only where allowed and matching the manifest', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version?: string;
      packageManager?: string;
      engines?: { node?: string; dsh?: string };
    };
    const nodeEngine = manifest.engines?.node ?? '';
    const dshEngine = manifest.engines?.dsh ?? '';
    const allowedVersions = new Set(
      [manifest.version, manifest.packageManager, nodeEngine, dshEngine]
        .filter((value): value is string => typeof value === 'string')
        .flatMap(value => value.match(VERSION_TOKEN) ?? []),
    );
    const versionPattern = VERSION_TOKEN;
    const allowedFiles = new Set(['README.md', 'docs/operations/install.md']);
    const errors: string[] = [];
    for (const file of maintainedFiles) {
      const path = relativePath(file);
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(versionPattern)) {
        const token = match[0];
        const before = text.slice(Math.max(0, match.index - 1), match.index);
        if (before === 'v') continue;
        if (!allowedFiles.has(path)) {
          errors.push(path + ' states version ' + token + ' outside the allowed files');
          continue;
        }
        if (!allowedVersions.has(token)) errors.push(path + ' states version ' + token + ' that disagrees with package.json');
      }
      if (!allowedFiles.has(path)) continue;
      for (const claim of text.matchAll(/\`([^\`]*)\`/g)) {
        const value = (claim[1] ?? '').trim().replace(/\s+/g, ' ');
        if (!CONSTRAINT.test(value)) continue;
        const context = text.slice(Math.max(0, (claim.index ?? 0) - 60), claim.index ?? 0);
        const subjects = [...context.matchAll(/\b(DSH|Node(?:\.js)?)\b/g)];
        const subject = subjects.length === 0 ? undefined : subjects[subjects.length - 1]?.[1];
        const nodeClaim = nodeEngine.replace(/\s+/g, ' ').trim();
        const dshClaim = dshEngine.replace(/\s+/g, ' ').trim();
        const wanted = subject === 'DSH' ? [dshClaim] : subject === undefined ? [nodeClaim, dshClaim] : [nodeClaim];
        if (!wanted.includes(value)) errors.push(path + ' states a version constraint that disagrees with package.json: ' + value);
      }
      for (const claim of text.matchAll(PROSE_CONSTRAINT)) {
        const normalized = (claim[2] ?? '').replace(/\s+/g, ' ').trim();
        const nodeClaim = nodeEngine.replace(/\s+/g, ' ').trim();
        const dshClaim = dshEngine.replace(/\s+/g, ' ').trim();
        const wanted = claim[1] === 'DSH' ? [dshClaim] : [nodeClaim];
        if (!wanted.includes(normalized)) errors.push(path + ' states a version constraint that disagrees with package.json: ' + normalized);
      }
    }
    expect(errors).toEqual([]);
  });

  it('keeps the instruction files under their ceiling', () => {
    const rootLines = readFileSync(agentsPath, 'utf8').split('\n').length;
    const standardLines = readFileSync(docsAgentsPath, 'utf8').split('\n').length;
    expect(rootLines).toBeLessThanOrEqual(60);
    expect(standardLines).toBeLessThanOrEqual(140);
  });
});
