import { describe, expect, it } from 'vitest';
import { COLUMN_GAP, fitTable, textWidth } from './tableFit';

// The width a 360 dp phone gives a table inside a report card.
const SMALL = 288;

const months = {
  columns: ['Month', 'Money in', 'Money out', 'Net'],
  numeric: [false, true, true, true],
  rows: [
    ['Dec 2025', '₹0', '₹0', '₹0'],
    ['Jan 2026', '₹1,50,000', '₹25,300.50', '₹1,24,699.50'],
    ['Feb 2026', '₹96,899', '₹39,919', '₹56,980'],
  ],
};

const largest = {
  columns: ['Date', 'Paid to', 'Amount', 'Category'],
  numeric: [false, false, true, false],
  rows: [
    ['23 Feb 2026', 'CRED', '₹18,450', 'Unknown'],
    ['11 Feb 2026', 'IMPS TRANSFER TO 4417', '₹15,000', 'Unknown'],
    ['20 Jan 2026', 'RESTAURANT BILL - DINNER', '₹3,400', 'Food & Dining'],
  ],
};

const fit = (t: typeof months, width: number, size = 13) =>
  fitTable(t.columns, t.numeric, t.rows, width, size, (size * 12.6) / 13);

const widest = (t: typeof months, i: number, size = 13) => Math.max(...t.rows.map((r) => textWidth(r[i], size)));

const used = (widths: number[]) => widths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (widths.length - 1);

describe('fitTable', () => {
  it('estimates a figure a little wider than Roboto draws it', () => {
    // Measured on the emulator: "₹25,300.50" at 13 pt is 64 dp wide.
    expect(textWidth('₹25,300.50', 13)).toBeGreaterThanOrEqual(64);
    expect(textWidth('₹25,300.50', 13)).toBeLessThan(80);
  });

  it('keeps every figure whole on a 360 dp phone, letting the month wrap', () => {
    const f = fit(months, SMALL);
    expect(f.kind).toBe('table');
    if (f.kind !== 'table') return;
    for (const i of [1, 2, 3]) expect(f.widths[i]).toBeGreaterThanOrEqual(widest(months, i));
    expect(used(f.widths)).toBeLessThanOrEqual(SMALL + 0.001);
  });

  it('wraps long payee names before it narrows an amount', () => {
    const f = fit(largest, SMALL);
    expect(f.kind).toBe('table');
    if (f.kind !== 'table') return;
    expect(f.widths[2]).toBeGreaterThanOrEqual(widest(largest, 2));
    expect(f.widths[1]).toBeGreaterThanOrEqual(textWidth('RESTAURANT', 13));
    expect(used(f.widths)).toBeLessThanOrEqual(SMALL + 0.001);
  });

  it('leaves a table that fits at its natural widths', () => {
    const f = fit(months, 600);
    expect(f).toEqual({ kind: 'table', widths: expect.any(Array) });
    if (f.kind !== 'table') return;
    expect(used(f.widths)).toBeLessThan(600);
  });

  it('shows one block per row when even wrapped words do not fit', () => {
    expect(fit(months, 160).kind).toBe('rows');
    // A larger system font size needs more room for the same figures.
    expect(fit(months, SMALL, 13 * 1.6).kind).toBe('rows');
  });
});
