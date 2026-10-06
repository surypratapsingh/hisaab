/**
 * Column widths for a report table, worked out before it is drawn so that a figure is
 * never cut short or shrunk. Android's shrink-to-fit cuts digits instead of shrinking
 * them, and a table that scrolls sideways shows a figure cut at the card's edge.
 */

/**
 * Roughly how many ems a character takes in Roboto, rounded up so figures never wrap.
 * Roboto's digits are all 0.5615 em; a comma 0.2 and a full stop 0.26.
 */
const em = (ch: string): number =>
  /[0-9]/.test(ch) ? 0.57
  : ch === '₹' ? 0.6
  : ch === '%' ? 0.76
  : /[,.:;'\s]/.test(ch) ? 0.28
  : ch === '-' || ch === '−' ? 0.42
  : /[A-Z&]/.test(ch) ? 0.72
  : 0.56;

/** About how wide `text` is on one line at `size` points: a little over, never under. */
export const textWidth = (text: string, size: number): number =>
  Math.ceil([...text].reduce((w, ch) => w + em(ch), 0) * size) + 2;

const longestWord = (text: string, size: number): number =>
  Math.max(0, ...text.split(/\s+/).map((w) => textWidth(w, size)));

/** Space between two columns. */
export const COLUMN_GAP = 8;

/** Words in a text column wrap past this width even when there is room. */
const TEXT_COLUMN_MAX = 150;

export type TableFit = { kind: 'table'; widths: number[] } | { kind: 'rows' };

/**
 * Text columns take their natural width (up to 150) and, when the table is too wide,
 * give some back, down to their longest word, so their words wrap. Figure columns
 * always keep the width of their longest figure. When even that does not fit `width`,
 * the table is shown as one block per row instead (`rows`). Headings are measured at
 * `headSize`, values at `size`.
 */
export const fitTable = (
  columns: string[],
  numeric: boolean[],
  rows: string[][],
  width: number,
  size: number,
  headSize = size
): TableFit => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const values = (i: number) => rows.map((r) => r[i] ?? '');
  // A heading may wrap between its words in any column.
  const least = columns.map((c, i) =>
    Math.max(
      longestWord(c, headSize),
      ...values(i).map((v) => (numeric[i] ? textWidth(v, size) : longestWord(v, size)))
    )
  );
  const natural = columns.map((c, i) => {
    const whole = Math.max(textWidth(c, headSize), ...values(i).map((v) => textWidth(v, size)));
    return numeric[i] ? whole : Math.max(least[i], Math.min(whole, TEXT_COLUMN_MAX));
  });
  const room = width - COLUMN_GAP * (columns.length - 1);
  if (sum(natural) <= room) return { kind: 'table', widths: natural };
  if (sum(least) > room) return { kind: 'rows' };
  // What is too much comes off the columns that can give, each in proportion to how much it can.
  const over = sum(natural) - room;
  const give = natural.map((n, i) => n - least[i]);
  const canGive = sum(give);
  return { kind: 'table', widths: natural.map((n, i) => n - (give[i] / canGive) * over) };
};
