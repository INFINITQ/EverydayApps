// Lists the licenses of everything the apps ship: the npm packages installed for production
// (from pnpm) and the Rust crates compiled into them (from cargo; normal dependencies only,
// not build tools). Works offline. Writes docs/licenses.md, and fails when a package states
// no license.
//
// Usage: node tools/license-report.mjs   (or: pnpm licenses:report)
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const APPS = ['@folio/pdf', '@folio/hello', '@folio/slides'];
const BIG = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };
/** Licenses that ask something of whoever shares the app (fine for personal use). */
const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|CC-BY-SA)\b/i;

// npm: packages each app installs for production.
const npm = new Map();
for (const app of APPS) {
  const listed = JSON.parse(execSync(`pnpm --filter ${app} licenses list --prod --json`, BIG));
  for (const [license, packages] of Object.entries(listed)) {
    for (const pkg of packages) {
      if (pkg.name.startsWith('@folio/')) continue;
      for (const version of pkg.versions) {
        const key = `${pkg.name}@${version}`;
        const entry = npm.get(key) ?? { name: pkg.name, version, license, apps: new Set() };
        entry.apps.add(app.replace('@folio/', ''));
        npm.set(key, entry);
      }
    }
  }
}

// Rust: crates reachable from the apps through normal (shipped) dependencies, on Windows,
// plus Folio Slides' .ppt converter, its own workspace compiled to WebAssembly.
function shippedCrates(args) {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--offline', ...args], BIG));
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const members = new Set(metadata.workspace_members);
  const shipped = new Set();
  const queue = [...members];
  while (queue.length) {
    const node = nodes.get(queue.pop());
    for (const dep of node?.deps ?? []) {
      if (!dep.dep_kinds.some((kind) => kind.kind === null) || shipped.has(dep.pkg)) continue;
      shipped.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  return [...shipped]
    .filter((id) => !members.has(id))
    .map((id) => packages.get(id))
    .map((p) => ({ name: p.name, version: p.version, license: p.license ?? (p.license_file ? 'see its license file' : '') }));
}
const crates = new Map();
for (const args of [
  ['--filter-platform', 'x86_64-pc-windows-msvc'],
  ['--manifest-path', 'apps/slides/ppt-wasm/Cargo.toml', '--filter-platform', 'wasm32-unknown-unknown'],
]) {
  for (const crate of shippedCrates(args)) crates.set(`${crate.name}@${crate.version}`, crate);
}
const rust = [...crates.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const npmList = [...npm.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const unlicensed = [...npmList, ...rust].filter((p) => !p.license || /^(unknown|unlicensed)$/i.test(p.license));
const copyleft = [...npmList, ...rust].filter((p) => COPYLEFT.test(p.license));

const counts = new Map();
for (const p of npmList) counts.set(p.license, { npm: (counts.get(p.license)?.npm ?? 0) + 1, rust: counts.get(p.license)?.rust ?? 0 });
for (const p of rust) counts.set(p.license, { npm: counts.get(p.license)?.npm ?? 0, rust: (counts.get(p.license)?.rust ?? 0) + 1 });
const cell = (text) => String(text).replace(/\|/g, '\\|');

const lines = [
  '# Third-party licenses',
  '',
  `Made by \`node tools/license-report.mjs\` on ${new Date().toISOString().slice(0, 10)}. It lists what the apps ship:`,
  `${npmList.length} npm packages installed for production (some are only partly bundled, or not at all) and`,
  `${rust.length} Rust crates compiled into the apps. Build tools and test-only packages are left out.`,
  '',
  '`pdfium.wasm` (from `@embedpdf/pdfium`, MIT) is Google PDFium compiled to WebAssembly. PDFium is',
  'BSD-3-Clause, and its notice ships in that package as `LICENSE.pdfium`.',
  '',
  "Folio Slides' `ppt.wasm` is `apps/slides/ppt-wasm` (office_oxide and its crates, listed below) compiled",
  'to WebAssembly.',
  '',
  '## Summary',
  '',
  '| License | npm | Rust |',
  '| --- | ---: | ---: |',
  ...[...counts.entries()]
    .sort((a, b) => b[1].npm + b[1].rust - (a[1].npm + a[1].rust))
    .map(([license, n]) => `| ${cell(license || '(none)')} | ${n.npm} | ${n.rust} |`),
  '',
  '## Copyleft',
  '',
  copyleft.length
    ? 'These ask that changes to them be shared when the app is given to others (personal use is unaffected):'
    : 'None.',
  ...(copyleft.length ? ['', ...copyleft.map((p) => `- ${p.name} ${p.version}: ${p.license}`)] : []),
  '',
  '## npm packages',
  '',
  '| Package | Version | License | Apps |',
  '| --- | --- | --- | --- |',
  ...npmList.map((p) => `| ${cell(p.name)} | ${p.version} | ${cell(p.license)} | ${[...p.apps].sort().join(', ')} |`),
  '',
  '## Rust crates',
  '',
  '| Crate | Version | License |',
  '| --- | --- | --- |',
  ...rust.map((p) => `| ${cell(p.name)} | ${p.version} | ${cell(p.license)} |`),
  '',
];
writeFileSync(new URL('../docs/licenses.md', import.meta.url), lines.join('\n'));
console.log(`docs/licenses.md: ${npmList.length} npm packages, ${rust.length} Rust crates, ${copyleft.length} copyleft.`);
if (unlicensed.length) {
  console.error(`No license stated: ${unlicensed.map((p) => `${p.name} ${p.version}`).join(', ')}`);
  process.exit(1);
}
