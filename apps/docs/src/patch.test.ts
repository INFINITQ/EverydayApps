import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types
import { MARKERS, UNKNOWN, makeDocx, makeZip } from '../../../tools/fixtures/make-docx.mjs';
import { DocxPackage, decodeXml, readFacts } from './ooxml';
import { PatchError, baselineOf, canonicalXml, engineLosses, patchPackage, verifyPackage } from './patch';
import { LIMITS, ZipError, readZip, unpack, writeZip } from './zip';

const docx = (options = {}) => makeDocx(options) as Uint8Array;
const zip = (entries: { name: string; data: string | Uint8Array; store?: boolean }[]) => makeZip(entries) as Uint8Array;

/**
 * Stands in for the engine: writes every part again the way docx-editor does (no XML
 * declaration, namespaces reordered), optionally editing parts or leaving some out.
 */
function engineSave(
  pkg: DocxPackage,
  { edit = {}, drop = [], add = {} }: { edit?: Record<string, (xml: string) => string>; drop?: string[]; add?: Record<string, string> } = {},
): Uint8Array {
  const entries = pkg.names
    .filter((name) => !drop.includes(name))
    .map((name) => {
      const bytes = pkg.bytesOf(name)!;
      if (!/\.(xml|rels)$/.test(name)) return { name, data: bytes };
      let text = decodeXml(bytes).replace(/^<\?xml[^>]*\?>\s*/, '');
      text = text.replace(/^(<[\w:]+)((?:\s+xmlns:\w+="[^"]*")+)/, (_m, tag: string, ns: string) => tag + ns.split(/(?=\s+xmlns:)/).reverse().join(''));
      const change = edit[name];
      return { name, data: change ? change(text) : text };
    });
  for (const [name, data] of Object.entries(add)) entries.push({ name, data });
  return zip(entries);
}

const names = (bytes: Uint8Array) => new DocxPackage(bytes).names.sort();

describe('zip', () => {
  it('reads what the fixture generator writes and writes it back the same', () => {
    const bytes = docx();
    const entries = readZip(bytes);
    expect(entries.map((e) => e.name)).toContain('word/document.xml');
    const again = readZip(writeZip(entries));
    expect(again.map((e) => [e.name, e.crc])).toEqual(entries.map((e) => [e.name, e.crc]));
    for (const entry of again) expect(unpack(entry)).toEqual(unpack(entries.find((e) => e.name === entry.name)!));
  });

  it('refuses archives that unpack to far more than their size', () => {
    const bomb = zip([{ name: 'word/document.xml', data: new Uint8Array(20 * 1024 * 1024) }]);
    expect(() => readZip(bomb)).toThrow(/unpacks to far more/);
    expect(() => readZip(bomb, { ...LIMITS, totalBytes: 1024 })).toThrow(ZipError);
  });

  it('catches a part whose stored size lies about its contents', () => {
    const data = new TextEncoder().encode('<a>'.padEnd(5000, 'x') + '</a>');
    const entries = readZip(zip([{ name: 'a.xml', data }]));
    const forged = { ...entries[0]!, size: 100 };
    expect(() => unpack(forged)).toThrow(/damaged/);
  });

  it('refuses files that are not zip archives, and protected or old Office files', () => {
    expect(() => new DocxPackage(new TextEncoder().encode('just text'))).toThrow(/isn't a Word document/);
    const ole = new Uint8Array(512);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => new DocxPackage(ole)).toThrow(/password-protected or in an old format/);
  });

  it('refuses a damaged entry (bad checksum)', () => {
    const bytes = docx({ plain: true });
    const entries = readZip(bytes);
    const document = entries.find((e) => e.name === 'word/document.xml')!;
    const broken = { ...document, raw: deflateRawSync(Buffer.from('<w:document/>'.padEnd(document.size, ' '))) };
    expect(() => unpack(broken)).toThrow(/checksum|damaged/);
  });
});

describe('reading facts', () => {
  it('finds macros, comments, tracked changes and outside links', () => {
    const facts = readFacts(new DocxPackage(docx({ macros: true })));
    expect(facts.macros).toBe(true);
    expect(facts.comments).toEqual([{ id: '0', author: 'Reviewer', date: '2026-01-02T10:00:00Z', text: MARKERS.comment }]);
    expect(facts.revisions).toBe(2);
    expect(facts.changes.map((c) => [c.kind, c.author, c.text])).toEqual([
      ['insertion', 'Reviewer', MARKERS.inserted],
      ['deletion', 'Reviewer', MARKERS.deleted],
    ]);
    expect(facts.linkedPictures).toBe(1);
    expect(facts.hyperlinks).toBe(1);
    expect(facts.title).toBe(MARKERS.title);
    expect(readFacts(new DocxPackage(docx())).macros).toBe(false);
  });
});

describe('canonical XML', () => {
  it('ignores namespace prefixes, attribute order, the declaration and layout whitespace', () => {
    const a = '<?xml version="1.0"?>\n<a:x xmlns:a="urn:a" xmlns:b="urn:b" b:k="1" a:j="2">\n  <a:t> keep </a:t>\n</a:x>';
    const b = '<p:x xmlns:q="urn:b" xmlns:p="urn:a" p:j="2" q:k="1"><p:t> keep </p:t></p:x>';
    expect(canonicalXml(a)).toBe(canonicalXml(b));
    expect(canonicalXml(a)).not.toBe(canonicalXml(b.replace(' keep ', 'keep')));
    expect(canonicalXml(a)).not.toBe(canonicalXml(b.replace('q:k="1"', 'q:k="3"')));
  });
});

describe('patching a save', () => {
  const original = () => new DocxPackage(docx({ macros: true }));
  const editBody = (xml: string) => xml.replace(MARKERS.body, `EDITED ${MARKERS.body}`);

  it('keeps every untouched part byte for byte and takes the edited part from the engine', () => {
    const pkg = original();
    const baseline = baselineOf(engineSave(pkg));
    const { bytes, report } = patchPackage(pkg, baseline, engineSave(pkg, { edit: { 'word/document.xml': editBody } }));
    expect(report.replaced).toEqual(['word/document.xml']);
    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    const saved = new DocxPackage(bytes);
    expect(saved.names).toEqual(pkg.names);
    for (const name of pkg.names.filter((n) => n !== 'word/document.xml')) {
      expect(saved.entry(name)!.raw, name).toEqual(pkg.entry(name)!.raw);
    }
    const text = saved.text('word/document.xml')!;
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(text).toContain(`EDITED ${MARKERS.body}`);
    expect(text).toContain(UNKNOWN.element.slice(0, 20));
  });

  it('saves the original bytes when nothing changed', () => {
    const pkg = original();
    const out = patchPackage(pkg, baselineOf(engineSave(pkg)), engineSave(pkg));
    expect(out.report.replaced).toEqual([]);
    expect(new DocxPackage(out.bytes).entries.map((e) => e.raw)).toEqual(pkg.entries.map((e) => e.raw));
  });

  it('carries over parts and relationships the engine never writes', () => {
    const pkg = original();
    const dropRel = (xml: string) => xml.replace(/<Relationship Id="rIdUnknown1"[^>]*\/>/, '');
    const engine = (edit: Record<string, (x: string) => string>) =>
      engineSave(pkg, {
        drop: [UNKNOWN.part, 'word/vbaProject.bin'],
        edit: {
          'word/_rels/document.xml.rels': (x) => dropRel(x).replace(/<Relationship Id="rIdVba"[^>]*\/>/, ''),
          '[Content_Types].xml': (x) => x.replace(/<Override PartName="\/word\/folio-unknown.xml"[^>]*\/>/, '').replace('macroEnabled.main', 'xxx'),
          ...edit,
        },
      });
    const baseline = baselineOf(engine({}));
    const { bytes, report } = patchPackage(pkg, baseline, engine({ 'word/document.xml': editBody }));
    expect(report.carried.sort()).toEqual([UNKNOWN.part, 'word/vbaProject.bin'].sort());
    const saved = new DocxPackage(bytes);
    expect(saved.bytesOf(UNKNOWN.part)).toEqual(pkg.bytesOf(UNKNOWN.part));
    expect(saved.bytesOf('word/vbaProject.bin')).toEqual(pkg.bytesOf('word/vbaProject.bin'));
    const rels = saved.relationships('word/document.xml').map((r) => r.id);
    expect(rels).toContain('rIdUnknown1');
    expect(rels).toContain('rIdVba');
    const types = saved.text('[Content_Types].xml')!;
    expect(types).toContain('application/vnd.ms-word.document.macroEnabled.main+xml');
    expect(types).toContain(UNKNOWN.contentType);
  });

  it('drops a part the edit removed, and keeps the relationships of the rest', () => {
    const pkg = new DocxPackage(docx());
    const baseline = baselineOf(engineSave(pkg));
    const removePicture = engineSave(pkg, {
      drop: ['word/media/image1.png'],
      edit: {
        'word/_rels/document.xml.rels': (x) => x.replace(/<Relationship Id="rIdImage1"[^>]*\/>/, ''),
        'word/document.xml': (x) => x.replace(/<w:p><w:r><w:drawing>(?:(?!<\/w:p>).)*r:embed="rIdImage1"(?:(?!<\/w:p>).)*<\/w:p>/, ''),
      },
    });
    const { bytes, report } = patchPackage(pkg, baseline, removePicture);
    expect(report.removed).toEqual(['word/media/image1.png']);
    const saved = new DocxPackage(bytes);
    expect(saved.has('word/media/image1.png')).toBe(false);
    expect(saved.relationships('word/document.xml').map((r) => r.id)).not.toContain('rIdImage1');
  });

  it('adds new parts the engine wrote (an inserted picture)', () => {
    const pkg = new DocxPackage(docx({ plain: true }));
    const png = docx().slice(0, 0);
    const withPicture = engineSave(pkg, {
      add: { 'word/media/new.png': String.fromCharCode(...png) || 'PNG' },
      edit: {
        'word/_rels/document.xml.rels': (x) =>
          x.replace('</Relationships>', '<Relationship Id="rIdNew" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/new.png"/></Relationships>'),
        '[Content_Types].xml': (x) => x.replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'),
        'word/document.xml': (x) => x.replace('</w:body>', '<w:p><w:r><w:t>see rIdNew</w:t></w:r></w:p></w:body>'),
      },
    });
    const { report } = patchPackage(pkg, baselineOf(engineSave(pkg)), withPicture);
    expect(report.added).toEqual(['word/media/new.png']);
  });

  it('refuses to produce a file whose changed part refers to a missing relationship', () => {
    const pkg = new DocxPackage(docx());
    const broken = engineSave(pkg, { edit: { 'word/document.xml': (x) => x.replace('r:embed="rIdImage1"', 'r:embed="rIdNowhere"') } });
    expect(() => patchPackage(pkg, baselineOf(engineSave(pkg)), broken)).toThrow(PatchError);
  });

  it('tolerates problems the original already had', () => {
    const pkg = new DocxPackage(docx());
    const relsPath = 'word/_rels/document.xml.rels';
    const damaged = engineSave(pkg, {
      edit: { [relsPath]: (x) => x.replace('</Relationships>', '<Relationship Id="rIdGone" Type="x" Target="missing.xml"/></Relationships>') },
    });
    expect(() => verifyPackage(damaged, new DocxPackage(damaged))).not.toThrow();
    expect(() => verifyPackage(damaged, pkg)).toThrow(/missing\.xml/);
  });

  it('reports what the engine drops when it writes the document', () => {
    const pkg = new DocxPackage(docx());
    const lossy = engineSave(pkg, {
      edit: { 'word/document.xml': (x) => x.replace(/<fx:mystery[^]*?<\/fx:mystery>/, '').replace(/<w:ins [^>]*>/, '').replace('</w:ins>', '') },
    });
    const labels = engineLosses(pkg, baselineOf(lossy)).map((l) => l.label);
    expect(labels).toContain('tracked changes');
    expect(labels.some((l) => l.includes('fx:mystery'))).toBe(true);
    expect(engineLosses(pkg, baselineOf(engineSave(pkg)))).toEqual([]);
  });

  it('round-trips names exactly', () => {
    const pkg = new DocxPackage(docx());
    expect(names(patchPackage(pkg, null, engineSave(pkg)).bytes)).toEqual(names(pkg.bytes));
  });
});
