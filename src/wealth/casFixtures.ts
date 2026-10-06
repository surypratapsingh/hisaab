// Sample CAS texts for tests, shaped like the real statements' lines.

/** Shaped like the CAMS + KFintech detailed CAS, one PDF line per text line. */
export const MF_CAS = [
  'Consolidated Account Statement',
  'Statement Period : 01-Jan-2024 To 25-Sep-2026',
  'Email Id: someone@example.com',
  'Folio No: 91012345678 / 0  PAN: ABCDE1234F  KYC: OK  PAN: OK',
  'A Sample Investor',
  'B92Z-Parag Parikh Flexi Cap Fund - Direct Plan Growth - ISIN: INF879O01027(Advisor: DIRECT) Registrar : CAMS',
  'Opening Unit Balance: 1,000.000',
  '05-Aug-2026 Purchase - Systematic 5,000.00 60.912 82.0850 1,060.912',
  '05-Sep-2026 Purchase - Systematic 5,000.00 59.876 83.5060 1,120.788',
  'Closing Unit Balance: 1,120.788 NAV on 25-Sep-2026: INR 85.1234 Total Cost Value: 82,000.00 Market Value on 25-Sep-2026: INR 95,405.37',
  'Folio No: 5678901 / 23  PAN: ABCDE1234F  KYC: OK',
  '128TSDGG-Nippon India Nifty 50 Index Fund - Direct Growth - ISIN: INF204KB1ZN3 Registrar : KFINTECH',
  'Opening Unit Balance: 250.500',
  'Closing Unit Balance: 250.500',
  'NAV on 25-Sep-2026: INR 40.5670',
  'Total Cost Value: 8,000.00',
  'Market Value on 25-Sep-2026: INR 10,162.03',
  'Folio No: 1111111 / 1  PAN: ABCDE1234F',
  'XYZ1-Some Liquid Fund - Direct Growth - ISIN: INF123A01AB9 Registrar : CAMS',
  'Closing Unit Balance: 0.000 NAV on 25-Sep-2026: INR 1,234.5678 Total Cost Value: 0.00 Market Value on 25-Sep-2026: INR 0.00',
].join('\n');

/** Shaped like a depository CAS holdings table. */
export const DEMAT_CAS = [
  'NSDL Consolidated Account Statement',
  'Holdings as on 31-Aug-2026',
  'ISIN Security Current Bal. Market Price Value',
  'INE009A01021 INFOSYS LIMITED 10 1,500.50 15,005.00',
  'INE040A01034 HDFC BANK LIMITED 25 1,650.25 41,256.25',
  'IN0020230085 SOVEREIGN GOLD BOND 2023 SR III 2 6,100.00 12,200.00',
  'Total 68,461.25',
].join('\n');
