import { describe, it, expect } from 'vitest';
import { paise } from '@/money/money';
import { priceRuns, type PricePoint } from './priceSteps';

let n = 0;
/** `count` purchases at `rupees`, one per day starting `start`. */
const at = (rupees: number, start: string, count: number): PricePoint[] =>
  Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000);
    return { id: `p${++n}`, date: day.toISOString().slice(0, 10), amount: paise(rupees * 100) };
  });

const rupees = (runs: ReturnType<typeof priceRuns>) => runs?.map((r) => r.amount / 100);

describe('priceRuns', () => {
  it('finds the prices something has held, oldest first', () => {
    const runs = priceRuns([
      ...at(150, '2025-10-01', 20),
      ...at(170, '2026-01-01', 30),
      ...at(180, '2026-09-01', 4),
    ]);
    expect(rupees(runs)).toEqual([150, 170, 180]);
    expect(runs![0]).toMatchObject({ from: '2025-10-01', to: '2025-10-20', count: 20 });
    expect(runs![2]).toMatchObject({ from: '2026-09-01', to: '2026-09-04', count: 4 });
    expect(runs![1].ids).toHaveLength(30);
  });

  it('ignores one odd purchase that is not a price', () => {
    const runs = priceRuns([...at(170, '2026-01-01', 10), ...at(220, '2026-07-01', 1), ...at(180, '2026-09-01', 4)]);
    expect(rupees(runs)).toEqual([170, 180]);
  });

  it('sees a price that has only just changed once two purchases confirm it', () => {
    const runs = priceRuns([...at(170, '2026-01-01', 10), ...at(180, '2026-09-01', 2)]);
    expect(rupees(runs)).toEqual([170, 180]);
    // A single purchase at a new amount could be anything: not yet a price.
    expect(priceRuns([...at(170, '2026-01-01', 10), ...at(180, '2026-09-01', 1)])).toBeNull();
  });

  it('says nothing when the amount goes back and forth, which is quantity, not price', () => {
    const petrol = [
      ...at(200, '2025-03-01', 4),
      ...at(300, '2025-06-01', 4),
      ...at(200, '2025-08-01', 4),
      ...at(300, '2025-09-01', 4),
    ];
    expect(priceRuns(petrol)).toBeNull();
  });

  it('says nothing for one price, or too few purchases', () => {
    expect(priceRuns(at(199, '2025-03-01', 10))).toBeNull();
    expect(priceRuns(at(199, '2025-03-01', 2))).toBeNull();
    expect(priceRuns([])).toBeNull();
  });

  it('treats a single purchase at another price between two stretches at the same one as a blip', () => {
    const runs = priceRuns([
      ...at(150, '2025-10-01', 5),
      ...at(170, '2025-11-01', 1),
      ...at(150, '2025-11-02', 5),
      ...at(170, '2026-01-01', 3),
    ]);
    expect(rupees(runs)).toEqual([150, 170]);
    expect(runs![0]).toMatchObject({ from: '2025-10-01', to: '2025-11-06', count: 10 });
    expect(runs![1].count).toBe(3);
  });

  it('does not count a short spell at some price as a price of its own', () => {
    // Two purchases at 120 before the long stretch at 150: not enough to call it a price.
    const runs = priceRuns([...at(120, '2025-10-01', 2), ...at(150, '2025-10-10', 20), ...at(170, '2026-01-01', 5)]);
    expect(rupees(runs)).toEqual([150, 170]);
    // ...even if it was paid that price again, later in another stretch.
    const again = priceRuns([
      ...at(120, '2025-09-01', 2),
      ...at(150, '2025-10-10', 20),
      ...at(120, '2025-12-01', 1),
      ...at(170, '2026-01-01', 5),
    ]);
    expect(rupees(again)).toEqual([150, 170]);
  });

  it('does not call a jump to another pack or brand a price move: paneer 330, then 180', () => {
    expect(priceRuns([...at(330, '2025-10-01', 12), ...at(180, '2026-02-01', 6)])).toBeNull();
  });

  it('tells the story since such a jump, though', () => {
    const runs = priceRuns([...at(330, '2025-10-01', 12), ...at(180, '2026-02-01', 6), ...at(190, '2026-08-01', 3)]);
    expect(rupees(runs)).toEqual([180, 190]);
  });

  it('is not sure of the current price from a single purchase', () => {
    const points = [...at(180, '2025-01-01', 2), ...at(170, '2025-06-01', 5), ...at(180, '2026-06-01', 1)];
    expect(priceRuns(points)).toBeNull();
  });

  it('works whatever order the purchases come in', () => {
    const points = [...at(150, '2025-10-01', 5), ...at(170, '2026-01-01', 5)].reverse();
    expect(rupees(priceRuns(points))).toEqual([150, 170]);
  });
});
