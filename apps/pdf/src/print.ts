// Printing without frames (the content policy allows none): each page is rendered to an
// image by PDFium, the images go into a print-only container, and the window prints.

type RenderScope = {
  renderPage(options: { pageIndex: number; options?: { scaleFactor?: number; withAnnotations?: boolean } }): {
    toPromise(): Promise<Blob>;
  };
};

export async function printPages(render: RenderScope, pages: number): Promise<void> {
  const container = document.createElement('div');
  container.className = 'pdf-print';
  const urls: string[] = [];
  try {
    for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
      const blob = await render.renderPage({ pageIndex, options: { scaleFactor: 2, withAnnotations: true } }).toPromise();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const image = document.createElement('img');
      image.className = 'pdf-print-page';
      image.alt = `Page ${pageIndex + 1}`;
      image.src = url;
      container.append(image);
    }
    document.body.append(container);
    await Promise.all([...container.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)));
    window.print();
  } finally {
    container.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
