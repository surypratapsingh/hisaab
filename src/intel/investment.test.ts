import { describe, it, expect } from 'vitest';
import { detectInvestment } from './investment';

describe('investment detection', () => {
  it.each([
    ['ACH D- BSE LTD ICCL-MF-12345678', 'ICCL clearing'],
    ['NACH DR BSESTARMF 889123', 'BSE StAR MF'],
    ['SIP HDFC MID CAP OPP FUND', 'SIP'],
    ['UPI/ZERODHA BROKING LTD/zerodha@hdfcbank', 'Zerodha'],
    ['UPI-GROWW INVEST TECH-groww.mf@axisbank', 'Groww'],
    ['ACH DR NSE CLEARING LTD', 'NSE clearing'],
    ['NACH-DR-CAMS-PPFAS MUTUAL FUND', 'mutual fund'],
    ['NPS TRUST A/C 1100', 'NPS'],
    ['TRF TO PPF A/C 3321', 'PPF'],
    ['RD INSTALLMENT 0042', 'recurring deposit'],
  ])('recognises %s', (narration, evidence) => {
    const found = detectInvestment(narration, true);
    expect(found.isInvestment).toBe(true);
    expect(found.evidence).toBe(evidence);
  });

  it.each([
    'SWIGGY ORDER 4451',
    'HDFC LIFE INSURANCE PREMIUM',
    'GOSSIP CAFE',
    'AMAZON MF PURCHASE',
    'RELIANCE FRESH',
    'NEFT TRANSFER TO RAMESH',
  ])('leaves ordinary spending alone: %s', (narration) => {
    expect(detectInvestment(narration, true).isInvestment).toBe(false);
  });

  it('never calls a credit an investment, even from a fund house', () => {
    expect(detectInvestment('ZERODHA PAYOUT', false).isInvestment).toBe(false);
    expect(detectInvestment('HDFC MUTUAL FUND REDEMPTION', false).isInvestment).toBe(false);
  });
});
