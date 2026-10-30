// Printing (and exporting to PDF through Windows' "Microsoft Print to PDF"): every slide
// that isn't hidden is drawn into a print-only container, one slide per page at the
// slide's own proportions, and the window prints. Text stays text, so a PDF made this way
// keeps it selectable. No frames are needed (the content policy allows none).

import type { SlideHandle } from '@aiden0z/pptx-renderer';
import { type Deck, type RenderOptions, renderInto } from './render';

export async function printDeck(deck: Deck, options: RenderOptions): Promise<void> {
  const { width, height } = deck.presentation;
  const container = document.createElement('div');
  container.className = 'slides-print';
  // Page size follows the slide: 10 inches wide, height in proportion.
  const style = document.createElement('style');
  const pageWidth = 10;
  const pageHeight = (pageWidth * height) / width;
  style.textContent =
    `@page { size: ${pageWidth}in ${pageHeight.toFixed(3)}in; margin: 0; }` +
    `.slides-print-page { width: ${pageWidth}in; height: ${pageHeight.toFixed(3)}in; }` +
    `.slides-print-page > div { transform: scale(${((pageWidth * 96) / width).toFixed(5)}); }`;
  const handles: SlideHandle[] = [];
  try {
    deck.presentation.slides.forEach((slide, index) => {
      if (slide.hidden) return;
      const page = document.createElement('div');
      page.className = 'slides-print-page';
      const inner = document.createElement('div');
      inner.style.width = `${width}px`;
      inner.style.height = `${height}px`;
      inner.style.transformOrigin = '0 0';
      const handle = renderInto(deck, index, { ...options, onNavigate: () => undefined });
      if (!handle) return;
      handles.push(handle);
      inner.append(handle.element);
      page.append(inner);
      container.append(page);
    });
    document.head.append(style);
    document.body.append(container);
    document.body.classList.add('slides-printing');
    await Promise.all(handles.map((h) => h.ready.catch(() => undefined)));
    await Promise.all([...container.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)));
    await document.fonts?.ready;
    window.print();
  } finally {
    document.body.classList.remove('slides-printing');
    container.remove();
    style.remove();
    for (const handle of handles) handle.dispose();
  }
}
