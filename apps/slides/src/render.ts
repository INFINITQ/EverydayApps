// Folio's package → the slide renderer (@aiden0z/pptx-renderer). The renderer gets the
// parts straight from Folio's own package (no second unzip), media is read only when a
// slide shows it, external media is never fetched, and links go through Folio.

import {
  type MediaResolver,
  type PptxFiles,
  type PresentationData,
  type SlideHandle,
  type SlideNode,
  buildPresentation,
  materializeSlideNodes,
  renderSlide,
} from '@aiden0z/pptx-renderer';
import { type Package, type Part, bytesOf, textOf } from './pkg';
import { isSafeXml } from './xml';

export type Deck = {
  pkg: Package;
  presentation: PresentationData;
};

const RULES: [RegExp, keyof PptxFiles][] = [
  [/^ppt\/slides\/_rels\/[^/]+\.xml\.rels$/, 'slideRels'],
  [/^ppt\/slides\/[^/]+\.xml$/, 'slides'],
  [/^ppt\/slideLayouts\/_rels\/[^/]+\.xml\.rels$/, 'slideLayoutRels'],
  [/^ppt\/slideLayouts\/[^/]+\.xml$/, 'slideLayouts'],
  [/^ppt\/slideMasters\/_rels\/[^/]+\.xml\.rels$/, 'slideMasterRels'],
  [/^ppt\/slideMasters\/[^/]+\.xml$/, 'slideMasters'],
  [/^ppt\/theme\/(?!themeOverride[^/]*\.xml$)[^/]+\.xml$/, 'themes'],
  [/^ppt\/theme\/themeOverride[^/]*\.xml$/, 'themeOverrides'],
  [/^ppt\/charts\/_rels\/[^/]+\.xml\.rels$/, 'chartRels'],
  [/^ppt\/charts\/(?!style[^/]*\.xml$)(?!colors[^/]*\.xml$)[^/]+\.xml$/, 'charts'],
  [/^ppt\/charts\/style[^/]*\.xml$/, 'chartStyles'],
  [/^ppt\/charts\/colors[^/]*\.xml$/, 'chartColors'],
  [/^ppt\/diagrams\/[^/]+\.xml$/, 'diagramDrawings'],
];

/** The renderer's view of the package (the same layout its own unzip produces). */
export function filesOf(pkg: Package): PptxFiles {
  const files: PptxFiles = {
    contentTypes: '',
    presentation: '',
    presentationRels: '',
    slides: new Map(),
    slideRels: new Map(),
    slideLayouts: new Map(),
    slideLayoutRels: new Map(),
    slideMasters: new Map(),
    slideMasterRels: new Map(),
    themes: new Map(),
    themeOverrides: new Map(),
    media: new Map(),
    fonts: new Map(),
    charts: new Map(),
    chartRels: new Map(),
    chartStyles: new Map(),
    chartColors: new Map(),
    diagramDrawings: new Map(),
  };
  const text = (name: string) => {
    const value = textOf(pkg, name) ?? '';
    // Parts with a DTD never reach the renderer's XML parser (no entity expansion).
    return isSafeXml(value) ? value : '';
  };
  for (const [name, part] of pkg.parts) {
    if (name === '[Content_Types].xml') files.contentTypes = text(name);
    else if (name === 'ppt/presentation.xml') files.presentation = text(name);
    else if (name === 'ppt/_rels/presentation.xml.rels') files.presentationRels = text(name);
    else if (name === 'ppt/tableStyles.xml') files.tableStyles = text(name);
    else if (/^ppt\/fonts\/[^/]+\.fntdata$/i.test(name)) {
      if (part.data) files.fonts!.set(name, part.data);
    } else if (name.startsWith('ppt/media/')) continue;
    else {
      const rule = RULES.find(([pattern]) => pattern.test(name));
      if (rule) (files[rule[1]] as Map<string, string>).set(name, text(name));
    }
  }
  files.mediaResolver = mediaResolver(pkg);
  return files;
}

/** Where the renderer looks for a media target: always under ppt/media/. */
function candidates(target: string): string[] {
  const segments: string[] = [];
  for (const segment of target.split(/[?#]/)[0]!.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const at = segments.lastIndexOf('media');
  const rest = (at >= 0 && at < segments.length - 1 ? segments.slice(at + 1) : segments.slice(-1)).join('/');
  const decoded = rest
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/');
  return [...new Set([`ppt/media/${decoded}`, `ppt/media/${rest}`])];
}

function mediaResolver(pkg: Package): MediaResolver {
  return {
    async resolve(target) {
      for (const name of candidates(target)) {
        const data = await bytesOf(pkg, name).catch(() => undefined);
        if (data) return { mediaPath: name, data };
      }
      return undefined;
    },
  };
}

/** Embedded fonts are read up front (the renderer wants them synchronously). */
export async function loadFonts(pkg: Package): Promise<void> {
  await Promise.all([...pkg.parts.keys()].filter((n) => /^ppt\/fonts\/[^/]+\.fntdata$/i.test(n)).map((n) => bytesOf(pkg, n)));
}

export function buildDeck(pkg: Package): Deck {
  return { pkg, presentation: buildPresentation(filesOf(pkg), { lazySlides: true }) };
}

let partIds = new WeakMap<Part, number>();
let nextPartId = 1;
const idOf = (part: Part | undefined) => {
  if (!part) return 0;
  let id = partIds.get(part);
  if (!id) partIds.set(part, (id = nextPartId++));
  return id;
};

/**
 * What a slide's picture depends on: its own part and relationships (layouts, masters and
 * themes are shared, so a change there changes every key), plus its position (slide numbers).
 */
export function renderKey(deck: Deck, index: number): string {
  const slide = deck.presentation.slides[index];
  if (!slide) return 'none';
  const path = slide.slidePath;
  const rels = path.replace(/([^/]+)$/, '_rels/$1.rels');
  const shared = [...deck.pkg.parts]
    .filter(([name]) => /^ppt\/(slideLayouts|slideMasters|theme)\//.test(name))
    .map(([, part]) => idOf(part))
    .join('.');
  return `${index}|${path}|${idOf(deck.pkg.parts.get(path))}|${idOf(deck.pkg.parts.get(rels))}|${shared}`;
}

/** A slide's top-level shapes (parsed on first use: decks are built lazily). */
export function nodesOf(deck: Deck, index: number): SlideNode[] {
  const slide = deck.presentation.slides[index];
  if (!slide) return [];
  materializeSlideNodes(deck.presentation, slide);
  return slide.nodes;
}

export type RenderOptions = {
  /** A clicked link: a slide in this deck or a web address. */
  onNavigate?: (target: { slideIndex?: number; url?: string }) => void;
  mediaUrlCache: Map<string, string>;
};

export function renderInto(deck: Deck, index: number, options: RenderOptions): SlideHandle | null {
  const slide = deck.presentation.slides[index];
  if (!slide) return null;
  materializeSlideNodes(deck.presentation, slide);
  return renderSlide(deck.presentation, slide, {
    externalMedia: 'block',
    pdfjs: false,
    mediaUrlCache: options.mediaUrlCache,
    onNavigate: options.onNavigate ?? (() => undefined),
    onNodeError: (id, error) => console.warn(`folio: shape ${id} couldn't be drawn`, error),
  });
}

/** Forget cached part ids (tests). */
export function resetRenderKeys() {
  partIds = new WeakMap();
}
