// Writes small, valid test PDFs with real (searchable) text, without any library: each page
// shows a heading and a few lines in Helvetica. With `{ form: true }` page 1 also gets a
// fillable form: a text field "full_name", a checkbox "agree", radio buttons "contact"
// (Email, Phone) and a dropdown "color" (Red, Green, Blue).
// `{ links: true }` adds three links to page 1: a web link (WEB_LINK), a `javascript:` link and
// one that asks to launch a program. `{ outline: true }` adds bookmarks: "Chapter 1" (with
// "Section 1.1" on page 2 inside it), "Chapter 2" (the last page) and "Example website" (a web
// link). `{ attachment: true }` attaches notes.txt (ATTACHMENT_TEXT). `{ info: {...} }` sets the
// title, author and subject in the document information.
// Used by the end-to-end tests.
//
// Usage: node tools/fixtures/make-pdf.mjs <out.pdf> [pages=3] [--form] [--links] [--outline] [--attachment]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_LINK = 'https://example.com/folio-test';
export const BOOKMARK_LINK = 'https://example.com/from-a-bookmark';
export const ATTACHMENT_TEXT = 'Notes attached to a Folio test document.\n';

export function makePdf(
  pages = 3,
  title = 'Folio test document',
  { form = false, links = false, outline = false, attachment = false, info = null } = {},
) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const escape = (text) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = (dict, data) => `<< ${dict} /Length ${Buffer.byteLength(data, 'latin1')} >>\nstream\n${data}\nendstream`;
  const circle = (cx, cy, r) => {
    const k = 0.5523 * r;
    return (
      `${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ` +
      `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ` +
      `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ` +
      `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c h`
    );
  };

  const catalog = add('');
  const pagesId = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const dingbats = form ? add('<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>') : 0;
  const fields = [];
  const kids = [];
  for (let n = 1; n <= pages; n++) {
    const lines = [
      `BT /F1 28 Tf 72 720 Td (${escape(`${title}`)}) Tj ET`,
      `BT /F1 16 Tf 72 680 Td (${escape(`Page ${n} of ${pages}`)}) Tj ET`,
      `BT /F1 12 Tf 72 640 Td (${escape('The quick brown fox jumps over the lazy dog.')}) Tj ET`,
      `BT /F1 12 Tf 72 620 Td (${escape(`Unique marker for this page: folio-marker-${n}`)}) Tj ET`,
    ];
    if (form && n === 1) {
      lines.push(`BT /F1 11 Tf 72 572 Td (${escape('Full name')}) Tj ET`);
      lines.push(`BT /F1 11 Tf 96 504 Td (${escape('I agree')}) Tj ET`);
      lines.push(`BT /F1 11 Tf 94 456 Td (${escape('Email')}) Tj ET`);
      lines.push(`BT /F1 11 Tf 174 456 Td (${escape('Phone')}) Tj ET`);
      lines.push(`BT /F1 11 Tf 264 456 Td (${escape('Color')}) Tj ET`);
    }
    if (links && n === 1) {
      lines.push(`BT /F1 12 Tf 72 400 Td (${escape('Web link')}) Tj ET`);
      lines.push(`BT /F1 12 Tf 72 370 Td (${escape('Script link')}) Tj ET`);
      lines.push(`BT /F1 12 Tf 72 340 Td (${escape('Program link')}) Tj ET`);
    }
    const content = add(stream('', lines.join('\n')));
    const pageId = add('');
    const annots = [];
    if (links && n === 1) {
      const link = (y, action) =>
        add(`<< /Type /Annot /Subtype /Link /Rect [68 ${y - 6} 240 ${y + 16}] /Border [0 0 0] /A ${action} >>`);
      annots.push(
        link(400, `<< /S /URI /URI (${escape(WEB_LINK)}) >>`),
        link(370, `<< /S /URI /URI (${escape('javascript:app.alert(1)')}) >>`),
        link(340, `<< /S /Launch /F (calc.exe) >>`),
      );
    }
    if (form && n === 1) {
      const name = add(
        `<< /Type /Annot /Subtype /Widget /FT /Tx /T (full_name) /TU (Full name) /F 4 ` +
          `/Rect [72 540 340 564] /P ${pageId} 0 R /DA (/Helv 12 Tf 0 g) ` +
          `/MK << /BC [0.45 0.45 0.45] /BG [1 1 1] >> /BS << /W 1 /S /S >> >>`,
      );
      const box = '0.45 G 1 w 0.5 0.5 15 15 re S';
      const off = add(stream('/Type /XObject /Subtype /Form /BBox [0 0 16 16]', box));
      const on = add(stream('/Type /XObject /Subtype /Form /BBox [0 0 16 16]', `${box}\n0 G 1.6 w 3.5 8 m 6.5 4.5 l 12.5 11.5 l S`));
      const agree = add(
        `<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /TU (I agree) /F 4 ` +
          `/Rect [72 500 88 516] /P ${pageId} 0 R /V /Off /AS /Off /DA (/ZaDb 0 Tf 0 g) ` +
          `/MK << /BC [0.45 0.45 0.45] /BG [1 1 1] /CA (4) >> /AP << /N << /Yes ${on} 0 R /Off ${off} 0 R >> >> >>`,
      );
      // Radio buttons: one field with a widget per choice; each widget's "on" state is its choice.
      const contact = add('');
      const ring = '0.45 G 1 w ' + circle(8, 8, 7) + ' S';
      const ringOff = add(stream('/Type /XObject /Subtype /Form /BBox [0 0 16 16]', ring));
      const ringOn = add(stream('/Type /XObject /Subtype /Form /BBox [0 0 16 16]', `${ring}\n0 g ${circle(8, 8, 3.5)} f`));
      const choices = [
        ['Email', 72],
        ['Phone', 152],
      ].map(([choice, x]) =>
        add(
          `<< /Type /Annot /Subtype /Widget /Parent ${contact} 0 R /Rect [${x} 452 ${x + 16} 468] ` +
            `/P ${pageId} 0 R /F 4 /AS /Off /MK << /BC [0.45 0.45 0.45] /BG [1 1 1] /CA (l) >> ` +
            `/AP << /N << /${choice} ${ringOn} 0 R /Off ${ringOff} 0 R >> >> >>`,
        ),
      );
      objects[contact - 1] =
        `<< /FT /Btn /Ff 49152 /T (contact) /TU (Contact by) /V /Off ` +
        `/Kids [${choices.map((c) => `${c} 0 R`).join(' ')}] >>`;
      // A dropdown (combo box) with three choices.
      const color = add(
        `<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (color) /TU (Favorite color) /F 4 ` +
          `/Rect [300 450 420 470] /P ${pageId} 0 R /Opt [(Red) (Green) (Blue)] /V (Red) ` +
          `/DA (/Helv 11 Tf 0 g) /MK << /BC [0.45 0.45 0.45] /BG [1 1 1] >> >>`,
      );
      annots.push(name, agree, ...choices, color);
      fields.push(name, agree, contact, color);
    }
    objects[pageId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R` +
      (annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : '') +
      ' >>';
    kids.push(pageId);
  }
  const acroForm = form
    ? ` /AcroForm << /Fields [${fields.map((f) => `${f} 0 R`).join(' ')}] /DA (/Helv 0 Tf 0 g) ` +
      `/DR << /Font << /Helv ${font} 0 R /ZaDb ${dingbats} 0 R >> >> /NeedAppearances true >>`
    : '';
  let extras = '';
  if (outline) {
    const root = add('');
    const [chapter1, section, chapter2, website] = [add(''), add(''), add(''), add('')];
    const goTo = (pageNumber) => `/Dest [${kids[Math.min(pageNumber, pages) - 1]} 0 R /Fit]`;
    objects[root - 1] = `<< /Type /Outlines /First ${chapter1} 0 R /Last ${website} 0 R /Count 3 >>`;
    // Chapter 1 starts closed (a negative count).
    objects[chapter1 - 1] =
      `<< /Title (Chapter 1) /Parent ${root} 0 R /Next ${chapter2} 0 R ` +
      `/First ${section} 0 R /Last ${section} 0 R /Count -1 ${goTo(1)} >>`;
    objects[section - 1] = `<< /Title (Section 1.1) /Parent ${chapter1} 0 R ${goTo(2)} >>`;
    objects[chapter2 - 1] =
      `<< /Title (Chapter 2) /Parent ${root} 0 R /Prev ${chapter1} 0 R /Next ${website} 0 R ${goTo(pages)} >>`;
    objects[website - 1] =
      `<< /Title (Example website) /Parent ${root} 0 R /Prev ${chapter2} 0 R ` +
      `/A << /S /URI /URI (${escape(BOOKMARK_LINK)}) >> >>`;
    extras += ` /Outlines ${root} 0 R /PageMode /UseOutlines`;
  }
  if (attachment) {
    const length = Buffer.byteLength(ATTACHMENT_TEXT, 'latin1');
    const file = add(stream(`/Type /EmbeddedFile /Subtype /text#2Fplain /Params << /Size ${length} >>`, ATTACHMENT_TEXT));
    const spec = add(
      `<< /Type /Filespec /F (notes.txt) /UF (notes.txt) /Desc (Meeting notes) /EF << /F ${file} 0 R /UF ${file} 0 R >> >>`,
    );
    extras += ` /Names << /EmbeddedFiles << /Names [(notes.txt) ${spec} 0 R] >> >>`;
  }
  const infoId = info
    ? add(
        `<< ${Object.entries(info)
          .map(([key, value]) => `/${key[0].toUpperCase()}${key.slice(1)} (${escape(String(value))})`)
          .join(' ')} >>`,
      )
    : 0;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${acroForm}${extras} >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;

  let pdf = '%PDF-1.7\n%âãÏÓ\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  const infoRef = infoId ? ` /Info ${infoId} 0 R` : '';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${infoRef} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Only when run as a script: imported by a test runner, argv[2] is the runner's own argument.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  const flag = (name) => process.argv.includes(`--${name}`);
  writeFileSync(
    process.argv[2],
    makePdf(Number(process.argv[3] ?? 3), undefined, {
      form: flag('form'),
      links: flag('links'),
      outline: flag('outline'),
      attachment: flag('attachment'),
    }),
  );
}
