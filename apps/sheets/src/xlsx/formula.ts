// Formula text helpers: Excel's "future function" prefixes, and moving relative references.

import { MAX_COLUMNS, MAX_ROWS, columnIndex, columnName } from './refs';

/** Functions newer than Excel 2007, which files must spell with a _xlfn. prefix. */
const FUTURE = new Set(
  (
    'AGGREGATE ARABIC BASE BETA.DIST BETA.INV BINOM.DIST BINOM.DIST.RANGE BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR ' +
    'BYCOL BYROW CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CHOOSECOLS CHOOSEROWS ' +
    'COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ERF.PRECISE ' +
    'ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FILTERXML FLOOR.MATH FLOOR.PRECISE FORECAST.ETS ' +
    'FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT FORECAST.LINEAR FORMULATEXT GAMMA GAMMA.DIST GAMMA.INV ' +
    'GAMMALN.PRECISE GAUSS GROUPBY HSTACK HYPGEOM.DIST IFNA IFS IMAGE IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ' +
    'ISFORMULA ISOMITTED ISOWEEKNUM LAMBDA LET LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS MODE.MULT MODE.SNGL MUNIT ' +
    'NEGBINOM.DIST NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTOF ' +
    'PERCENTRANK.EXC PERCENTRANK.INC PERMUTATIONA PHI PIVOTBY POISSON.DIST QUARTILE.EXC QUARTILE.INC RANDARRAY RANK.AVG RANK.EQ ' +
    'REDUCE REGEXEXTRACT REGEXREPLACE REGEXTEST RRI SCAN SEC SECH SEQUENCE SHEET SHEETS SINGLE SKEW.P SORTBY STDEV.P STDEV.S ' +
    'SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW TRIMRANGE ' +
    'UNICHAR UNICODE UNIQUE VALUETOTEXT ARRAYTOTEXT VAR.P VAR.S VSTACK WEBSERVICE WEIBULL.DIST WRAPCOLS WRAPROWS XLOOKUP XMATCH ' +
    'XOR Z.TEST'
  ).split(' '),
);
/** Worksheet functions spelled _xlfn._xlws. in files. */
const WORKSHEET = new Set(['FILTER', 'SORT']);

/** Calls `visit` for every stretch of the formula outside string literals and quoted names. */
function eachCodeSpan(formula: string, visit: (code: string) => string): string {
  let out = '';
  let at = 0;
  while (at < formula.length) {
    const quote = formula.slice(at).search(/["']/);
    if (quote < 0) {
      out += visit(formula.slice(at));
      break;
    }
    out += visit(formula.slice(at, at + quote));
    const q = formula[at + quote]!;
    let end = at + quote + 1;
    for (; end < formula.length; end++) {
      if (formula[end] === q) {
        if (formula[end + 1] === q) end++;
        else break;
      }
    }
    out += formula.slice(at + quote, end + 1);
    at = end + 1;
  }
  return out;
}

/** "=SUM(A1)" as a file writes it: no "=", future functions prefixed. */
export function formulaToFile(formula: string): string {
  const body = formula.startsWith('=') ? formula.slice(1) : formula;
  return eachCodeSpan(body, (code) =>
    code.replace(/(^|[^A-Za-z0-9_.])([A-Za-z][A-Za-z0-9.]*)(?=\()/g, (whole, before: string, name: string) => {
      const upper = name.toUpperCase();
      if (WORKSHEET.has(upper)) return `${before}_xlfn._xlws.${name}`;
      if (FUTURE.has(upper)) return `${before}_xlfn.${name}`;
      return whole;
    }),
  );
}

/**
 * Moves the relative references in a formula by `rows` and `columns` (what copying a
 * formula does). References that would leave the sheet become #REF!.
 */
export function shiftFormula(formula: string, rows: number, columns: number): string {
  if (!rows && !columns) return formula;
  return eachCodeSpan(formula, (code) =>
    code.replace(
      /(^|[^A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})(?![A-Za-z0-9_(.[])/g,
      (whole, before: string, colAbs: string, col: string, rowAbs: string, row: string) => {
        const c = columnIndex(col) + (colAbs ? 0 : columns);
        const r = Number(row) - 1 + (rowAbs ? 0 : rows);
        if (columnIndex(col) >= MAX_COLUMNS) return whole;
        if (c < 0 || c >= MAX_COLUMNS || r < 0 || r >= MAX_ROWS) return `${before}#REF!`;
        return `${before}${colAbs}${columnName(c)}${rowAbs}${r + 1}`;
      },
    ),
  );
}
