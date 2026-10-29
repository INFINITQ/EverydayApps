import { buildPresentation, materializeAllSlideNodes, parseZip, serializePresentation } from '@aiden0z/pptx-renderer';
import { describe, expect, it } from 'vitest';
import { notesOf, slidesOf } from './deck';
import { openPackage, savePackage, textOf } from './pkg';
import { SAMPLE, makePptx } from './testing/makePptx';
import { LINE_BREAK, patchParagraphs, setNotes, setShapeText, shapeText } from './text';
import { NS, parseXml } from './xml';
import { readZip } from './zip';

const A = NS.a;

function body(paragraphs: string): Element {
  const doc = parseXml(`<p:txBody xmlns:p="${NS.p}" xmlns:a="${A}"><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody>`, 'test');
  return doc.documentElement;
}

const xml = (element: Element) => new XMLSerializer().serializeToString(element).replace(/ xmlns:\w+="[^"]+"/g, '');

describe('patchParagraphs', () => {
  const plainAndBold =
    '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US"/><a:t>Revenue up </a:t></a:r><a:r><a:rPr lang="en-US" b="1"/><a:t>12%</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>';

  it('rewrites only the run that changed', () => {
    const b = body(plainAndBold);
    patchParagraphs(b, ['Revenue up 15%']);
    expect(xml(b)).toContain('<a:r><a:rPr lang="en-US"/><a:t>Revenue up </a:t></a:r><a:r><a:rPr lang="en-US" b="1"/><a:t>15%</a:t></a:r>');
    expect(xml(b)).toContain('<a:pPr algn="ctr"/>');
    expect(xml(b)).toContain('<a:endParaRPr lang="en-US"/>');
  });

  it('formats typed text like the character before it', () => {
    const end = body(plainAndBold);
    patchParagraphs(end, ['Revenue up 12% (est.)']);
    expect(xml(end)).toContain('b="1"/><a:t>12% (est.)</a:t>');
    const start = body(plainAndBold);
    patchParagraphs(start, ['Total revenue up 12%']);
    expect(xml(start)).toContain('<a:rPr lang="en-US"/><a:t>Total revenue up </a:t>');
    expect(xml(start)).toContain('b="1"/><a:t>12%</a:t>');
  });

  it('adds and removes paragraphs, copying the neighbour’s formatting', () => {
    const b = body(plainAndBold + '<a:p><a:r><a:rPr lang="en-US" i="1"/><a:t>Second</a:t></a:r></a:p>');
    patchParagraphs(b, ['Revenue up 12%', 'Inserted', 'Second']);
    const paragraphs = [...b.getElementsByTagNameNS(A, 'p')];
    expect(paragraphs).toHaveLength(3);
    expect(xml(paragraphs[1]!)).toContain('<a:pPr algn="ctr"/>');
    expect(xml(paragraphs[1]!)).toContain('b="1"/><a:t>Inserted</a:t>');
    patchParagraphs(b, ['Second']);
    expect([...b.getElementsByTagNameNS(A, 'p')]).toHaveLength(1);
    expect(xml(b)).toContain('i="1"/><a:t>Second</a:t>');
    patchParagraphs(b, []);
    expect([...b.getElementsByTagNameNS(A, 'p')]).toHaveLength(1);
  });

  it('turns U+2028 into line breaks and back', () => {
    const b = body('<a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>one</a:t></a:r></a:p>');
    patchParagraphs(b, [`one${LINE_BREAK}two`]);
    expect(xml(b)).toContain('<a:t>one</a:t></a:r><a:br><a:rPr lang="en-US" sz="2000"/></a:br><a:r><a:rPr lang="en-US" sz="2000"/><a:t>two</a:t></a:r>');
    patchParagraphs(b, ['onetwo']);
    expect(xml(b)).not.toContain('a:br');
  });

  it('keeps fields that were not touched, and makes plain text of edited ones', () => {
    const b = body('<a:p><a:r><a:rPr lang="en-US"/><a:t>Slide </a:t></a:r><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>4</a:t></a:fld></a:p>');
    patchParagraphs(b, ['Page 4']);
    expect(xml(b)).toContain('<a:fld id="{1}" type="slidenum">');
    patchParagraphs(b, ['Page 44']);
    expect(xml(b)).not.toContain('a:fld');
  });
});

describe('editing a deck', () => {
  it('edits a shape’s text and saves only that slide', async () => {
    const bytes = await makePptx(SAMPLE);
    const pkg = await openPackage(bytes);
    expect(shapeText(pkg, 'ppt/slides/slide2.xml', '3')).toEqual(['Revenue up 12%', 'Costs flat', 'Hiring two people']);
    const next = setShapeText(pkg, 'ppt/slides/slide2.xml', '3', ['Revenue up 15%', 'Costs flat', 'Hiring three people']);
    const saved = await savePackage(next);
    const before = new Map(readZip(bytes).entries.map((e) => [e.name, e.raw]));
    for (const entry of readZip(saved).entries) {
      if (entry.name === 'ppt/slides/slide2.xml') expect(entry.raw).not.toEqual(before.get(entry.name));
      else expect(entry.raw, entry.name).toEqual(before.get(entry.name));
    }
    // Read back by the renderer's own parser (JSZip), not Folio's.
    const presentation = buildPresentation(await parseZip(saved.slice().buffer));
    materializeAllSlideNodes(presentation);
    const text = JSON.stringify(serializePresentation(presentation).slides[1]);
    expect(text).toContain('Revenue up 15%');
    expect(text).toContain('Hiring three people');
    expect(textOf(next, 'ppt/slides/slide2.xml')).toContain('b="1" dirty="0"/><a:t>15%</a:t>');
  });

  it('edits notes, and creates a notes page for a slide without one', async () => {
    const pkg = await openPackage(await makePptx(SAMPLE));
    const [first, , , last] = slidesOf(pkg);
    const edited = setNotes(pkg, first!, 'Welcome everyone.\nKeep it very short.');
    expect(notesOf(edited, slidesOf(edited)[0]!)).toBe('Welcome everyone.\nKeep it very short.');

    const created = setNotes(edited, last!, 'Thank the team.');
    const slide = slidesOf(created)[3]!;
    expect(slide.notesPart).toBeTruthy();
    expect(notesOf(created, slide)).toBe('Thank the team.');
    expect(textOf(created, '[Content_Types].xml')).toContain(slide.notesPart!);

    const saved = await savePackage(created);
    const reopened = await openPackage(saved);
    expect(notesOf(reopened, slidesOf(reopened)[3]!)).toBe('Thank the team.');
    const files = await parseZip(saved.slice().buffer);
    expect(files.slideRels.get('ppt/slides/slide4.xml.rels') ?? files.slideRels.get('ppt/slides/_rels/slide4.xml.rels')).toContain('notesSlide');
  });
});
