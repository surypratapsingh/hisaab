import { describe, it, expect } from 'vitest';
import { shades } from './heat';

describe('shades', () => {
  it('leaves days with nothing spent unshaded', () => {
    expect(shades([0, 0, 0])).toEqual([0, 0, 0]);
    expect(shades([0, 500, 0])[0]).toBe(0);
  });

  it('spreads the spending days over four shades by rank', () => {
    expect(shades([100, 200, 300, 400])).toEqual([1, 2, 3, 4]);
    expect(shades([100, 200, 300, 400, 500, 600, 700, 800])).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('is not flattened by one enormous day', () => {
    // Rent on one day would leave every other day at the lightest shade if shading followed the size.
    expect(shades([120, 340, 90, 250000])).toEqual([2, 3, 1, 4]);
  });

  it('gives days that spent the same the same shade', () => {
    expect(shades([50, 50, 50, 900])).toEqual([3, 3, 3, 4]);
  });

  it('gives a single spending day the darkest shade', () => {
    expect(shades([0, 75, 0])).toEqual([0, 4, 0]);
  });
});
