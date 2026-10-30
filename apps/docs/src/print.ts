// Printing without frames (the content policy allows none) and without the engine's own print
// path, which needs a separate PDF converter: Folio paints every page of the current layout
// into a print-only container and prints the window. "Export as PDF" is the same, with
// Windows' "Microsoft Print to PDF" printer (or "Save as PDF") picked in the print dialog.

import { paintSemanticLayout } from '@docx-editor.dev/core/output';

type Layout = Parameters<typeof paintSemanticLayout>[1];
type Surface = { layout(): Layout };

/** The engine's page surface, from the editor the React adapter hands out. */
export function surfaceOf(editor: unknown): Surface | null {
  const surface = (editor as { surface?: Surface | null } | null)?.surface;
  return surface && typeof surface.layout === 'function' ? surface : null;
}

/** Paints every page into a new print container (not yet in the document). */
export function paintForPrint(surface: Surface): HTMLElement {
  const container = document.createElement('div');
  container.className = 'docs-print';
  container.setAttribute('aria-hidden', 'true');
  paintSemanticLayout(container, surface.layout(), { ariaHidden: true, showParagraphMarks: false });
  return container;
}

/** Page sizes for the printer: one named @page rule per distinct page size, in CSS pixels. */
export function pageRules(container: HTMLElement): string {
  const sizes = new Map<string, string>();
  const rules: string[] = [];
  for (const page of container.querySelectorAll<HTMLElement>('.docx-page')) {
    const width = parseFloat(page.style.width) || page.offsetWidth;
    const height = parseFloat(page.style.height) || page.offsetHeight;
    if (!width || !height) continue;
    const key = `${Math.round(width)}x${Math.round(height)}`;
    let name = sizes.get(key);
    if (!name) {
      name = `docs-page-${sizes.size + 1}`;
      sizes.set(key, name);
      rules.push(`@page ${name} { size: ${width}px ${height}px; margin: 0; }`);
    }
    page.style.setProperty('page', name);
  }
  return rules.join('\n');
}

export async function printPages(editor: unknown, { keep = false }: { keep?: boolean } = {}): Promise<HTMLElement | null> {
  const surface = surfaceOf(editor);
  if (!surface) throw new Error('The document isn’t ready to print yet.');
  const container = paintForPrint(surface);
  document.body.append(container);
  const style = document.createElement('style');
  style.textContent = pageRules(container);
  document.head.append(style);
  try {
    await Promise.all([...container.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)));
    window.print();
  } finally {
    if (!keep) {
      container.remove();
      style.remove();
    }
  }
  return keep ? container : null;
}
