// One Univer instance per open workbook, with the plugins Folio Sheets uses. Univer's own
// ribbon is off (Folio's Fluent toolbar replaces it); its formula bar, sheet tabs, context
// menus and side panels (conditional formatting, data validation, comments) stay.
//
// Airgapped: Univer draws on a canvas with the system's fonts, its styles and locale strings
// are bundled, and nothing here registers a network, telemetry or collaboration service.
// The formula engine's IMAGE function (which loads a picture from a web address) is removed;
// WEBSERVICE, RTD and CALL aren't implemented by Univer at all.

import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';
import '@univerjs/sheets-conditional-formatting-ui/lib/index.css';
import '@univerjs/sheets-data-validation-ui/lib/index.css';
import '@univerjs/sheets-filter-ui/lib/index.css';
import '@univerjs/sheets-sort-ui/lib/index.css';
import '@univerjs/find-replace/lib/index.css';
import '@univerjs/thread-comment-ui/lib/index.css';
import '@univerjs/drawing-ui/lib/index.css';
import '@univerjs/sheets-drawing-ui/lib/index.css';

import {
  type IURLImageService as URLImages,
  IURLImageService,
  type IWorkbookData,
  type Injector,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
  type Workbook,
  mergeLocales,
} from '@univerjs/core';
import { UniverDataValidationPlugin } from '@univerjs/data-validation';
import DesignEnUS from '@univerjs/design/locale/en-US';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import DocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { UniverDrawingUIPlugin } from '@univerjs/drawing-ui';
import DrawingUIEnUS from '@univerjs/drawing-ui/locale/en-US';
import { IFunctionService, UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFindReplacePlugin } from '@univerjs/find-replace';
import FindReplaceEnUS from '@univerjs/find-replace/locale/en-US';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting';
import { UniverSheetsConditionalFormattingUIPlugin } from '@univerjs/sheets-conditional-formatting-ui';
import SheetsCfUIEnUS from '@univerjs/sheets-conditional-formatting-ui/locale/en-US';
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation';
import { UniverSheetsDataValidationUIPlugin } from '@univerjs/sheets-data-validation-ui';
import SheetsDvUIEnUS from '@univerjs/sheets-data-validation-ui/locale/en-US';
import { UniverSheetsDrawingPlugin } from '@univerjs/sheets-drawing';
import { UniverSheetsDrawingUIPlugin } from '@univerjs/sheets-drawing-ui';
import SheetsDrawingUIEnUS from '@univerjs/sheets-drawing-ui/locale/en-US';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter';
import { UniverSheetsFilterUIPlugin } from '@univerjs/sheets-filter-ui';
import SheetsFilterUIEnUS from '@univerjs/sheets-filter-ui/locale/en-US';
import { UniverSheetsFindReplacePlugin } from '@univerjs/sheets-find-replace';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import SheetsFormulaUIEnUS from '@univerjs/sheets-formula-ui/locale/en-US';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';
import SheetsNumfmtUIEnUS from '@univerjs/sheets-numfmt-ui/locale/en-US';
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort';
import { UniverSheetsSortUIPlugin } from '@univerjs/sheets-sort-ui';
import SheetsSortUIEnUS from '@univerjs/sheets-sort-ui/locale/en-US';
import { UniverSheetsThreadCommentPlugin } from '@univerjs/sheets-thread-comment';
import { UniverSheetsThreadCommentUIPlugin } from '@univerjs/sheets-thread-comment-ui';
import SheetsThreadCommentUIEnUS from '@univerjs/sheets-thread-comment-ui/locale/en-US';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import SheetsUIEnUS from '@univerjs/sheets-ui/locale/en-US';
import { UniverThreadCommentPlugin } from '@univerjs/thread-comment';
import { UniverThreadCommentUIPlugin } from '@univerjs/thread-comment-ui';
import ThreadCommentUIEnUS from '@univerjs/thread-comment-ui/locale/en-US';
import { UniverUIPlugin } from '@univerjs/ui';
import UIEnUS from '@univerjs/ui/locale/en-US';

/**
 * Univer's picture loader, allowed only pictures held in memory (data: and blob: addresses).
 * Univer would otherwise fetch a picture's web address (a picture pasted from a web page, say).
 */
export class LocalPicturesOnly implements URLImages {
  static readonly refused = 'Pictures from the web are never loaded.';
  private static local(url: string) {
    return /^(data|blob):/i.test(url);
  }
  async getImage(url: string): Promise<string> {
    if (!LocalPicturesOnly.local(url)) throw new Error(LocalPicturesOnly.refused);
    return url;
  }
  async downloadImage(url: string): Promise<Blob> {
    if (!LocalPicturesOnly.local(url)) throw new Error(LocalPicturesOnly.refused);
    // eslint-disable-next-line no-restricted-globals -- reads a data: or blob: address held in memory (checked above), never the network
    return (await fetch(url)).blob();
  }
  registerURLImageDownloader() {
    return { dispose: () => undefined };
  }
}

/** Functions that would reach outside the PC; removed from the formula engine. */
export const BLOCKED_FUNCTIONS = ['IMAGE'];

const LOCALES = {
  [LocaleType.EN_US]: mergeLocales(
    DesignEnUS,
    UIEnUS,
    DocsUIEnUS,
    SheetsEnUS,
    SheetsUIEnUS,
    SheetsFormulaUIEnUS,
    SheetsNumfmtUIEnUS,
    SheetsCfUIEnUS,
    SheetsDvUIEnUS,
    SheetsFilterUIEnUS,
    SheetsSortUIEnUS,
    FindReplaceEnUS,
    ThreadCommentUIEnUS,
    SheetsThreadCommentUIEnUS,
    DrawingUIEnUS,
    SheetsDrawingUIEnUS,
  ),
};

export type SheetEngine = { univer: Univer; injector: Injector; workbook: Workbook };

/** Starts Univer in `container` with `data` as its one workbook. */
export function createEngine(container: HTMLElement, data: IWorkbookData, options: { dark: boolean }): SheetEngine {
  const univer = new Univer({
    locale: LocaleType.EN_US,
    locales: LOCALES,
    darkMode: options.dark,
    logLevel: LogLevel.ERROR,
  });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverUIPlugin, { container, header: true, toolbar: false, footer: true, contextMenu: true });
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsUIPlugin, {
    formulaBar: true,
    footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: false },
  });
  // Cached results from the file are shown as they are; only cells without one are computed.
  univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.WHEN_EMPTY });
  univer.registerPlugin(UniverSheetsFormulaUIPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingUIPlugin);
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationUIPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsFilterUIPlugin);
  univer.registerPlugin(UniverSheetsSortPlugin);
  univer.registerPlugin(UniverSheetsSortUIPlugin);
  univer.registerPlugin(UniverFindReplacePlugin);
  univer.registerPlugin(UniverSheetsFindReplacePlugin);
  univer.registerPlugin(UniverThreadCommentPlugin);
  univer.registerPlugin(UniverThreadCommentUIPlugin);
  univer.registerPlugin(UniverSheetsThreadCommentPlugin);
  univer.registerPlugin(UniverSheetsThreadCommentUIPlugin);
  univer.registerPlugin(UniverDrawingPlugin, { override: [[IURLImageService, { useClass: LocalPicturesOnly }]] });
  univer.registerPlugin(UniverDrawingUIPlugin);
  univer.registerPlugin(UniverSheetsDrawingPlugin);
  univer.registerPlugin(UniverSheetsDrawingUIPlugin);

  const workbook = univer.createUnit<IWorkbookData, Workbook>(UniverInstanceType.UNIVER_SHEET, data);
  const injector = univer.__getInjector();
  const functions = injector.get(IFunctionService);
  functions.unregisterExecutors(...BLOCKED_FUNCTIONS);
  functions.unregisterDescriptions(...BLOCKED_FUNCTIONS);
  return { univer, injector, workbook };
}
