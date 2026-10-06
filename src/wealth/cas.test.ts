import { describe, it, expect } from 'vitest';
import { parseCas, detectCas } from './cas';
import { format } from '@/money/money';
import { MF_CAS, DEMAT_CAS } from './casFixtures';

describe('reading a CAS', () => {
  it('tells a CAS from a bank statement', () => {
    expect(detectCas(MF_CAS)).toBe('mutual_fund');
    expect(detectCas(DEMAT_CAS)).toBe('demat');
    expect(detectCas('Booking Date,Value Date,Debit Amount,Credit Amount')).toBeNull();
  });

  it('reads every mutual fund scheme with units, NAV, cost and value', () => {
    const cas = parseCas(MF_CAS)!;
    expect(cas.kind).toBe('mutual_fund');
    expect(cas.source).toBe('CAMS + KFintech CAS');
    expect(cas.asOf).toBe('2026-09-25');
    expect(cas.holdings).toHaveLength(2); // the redeemed liquid fund is left out

    const [ppfas, nifty] = cas.holdings;
    expect(ppfas.name).toBe('Parag Parikh Flexi Cap Fund - Direct Plan Growth');
    expect(ppfas.isin).toBe('INF879O01027');
    expect(ppfas.folio).toBe('91012345678 / 0');
    expect(ppfas.unitsMilli).toBe(1120788);
    expect(ppfas.navX10000).toBe(851234);
    expect(format(ppfas.value)).toBe('Rs 95,405.37');
    expect(format(ppfas.cost!)).toBe('Rs 82,000.00');

    // The closing block wrapped over four lines here; it still reads.
    expect(nifty.name).toBe('Nippon India Nifty 50 Index Fund - Direct Growth');
    expect(nifty.folio).toBe('5678901 / 23');
    expect(nifty.unitsMilli).toBe(250500);
    expect(format(nifty.value)).toBe('Rs 10,162.03');
  });

  it('reads demat holdings: quantity, price and value per ISIN', () => {
    const cas = parseCas(DEMAT_CAS)!;
    expect(cas.kind).toBe('demat');
    expect(cas.source).toBe('NSDL CAS');
    expect(cas.asOf).toBe('2026-08-31');
    expect(cas.holdings.map((h) => h.name)).toEqual([
      'INFOSYS LIMITED',
      'HDFC BANK LIMITED',
      'SOVEREIGN GOLD BOND 2023 SR III',
    ]);
    expect(cas.holdings[0]).toMatchObject({ kind: 'equity', unitsMilli: 10000, navX10000: 15005000 });
    expect(format(cas.holdings[1].value)).toBe('Rs 41,256.25');
    expect(cas.holdings[2].kind).toBe('bond');
  });

  it('returns nothing for text that is not a CAS', () => {
    expect(parseCas('Dear customer, your statement is attached.')).toBeNull();
  });
});
