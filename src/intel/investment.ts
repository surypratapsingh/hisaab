export type InvestmentDetectionResult = {
  isInvestment: boolean;
  /** What in the narration gave it away, for tests and the detail screen. */
  evidence?: string;
};

/**
 * Wording that only ever appears on money going into an investment: the
 * clearing houses mutual fund orders settle through, the registrars, the
 * platforms that exist to invest, and the savings schemes a bank debits for.
 *
 * Deliberately absent: a bare "MF" or "FUND" (too many payees carry them),
 * bank names on their own (an HDFC debit is usually not an HDFC fund), and
 * anything about insurance, which is a premium, not an investment.
 */
const INVESTMENT_WORDING: Array<[RegExp, string]> = [
  [/\bSIP\b/, 'SIP'],
  [/\bMUTUAL\s*FUNDS?\b/, 'mutual fund'],
  [/\bBSE\s*STAR\s*MF\b|\bBSESTARMF\b/, 'BSE StAR MF'],
  [/\bICCL\b|\bINDIAN\s+CLEARING\s+CORP/, 'ICCL clearing'],
  [/\bNSE\s*CLEARING\b|\bNSCCL\b/, 'NSE clearing'],
  [/\bMF\s*UTILITIES\b|\bMFUTILITIES\b/, 'MF Utilities'],
  [/\bCAMS\b|\bKFIN\s*TECH|\bKFINTECH\b|\bKARVY\b/, 'fund registrar'],
  [/\bZERODHA\b/, 'Zerodha'],
  [/\bGROWW\b/, 'Groww'],
  [/\bUPSTOX\b|\bRKSV\b/, 'Upstox'],
  [/\bKUVERA\b/, 'Kuvera'],
  [/\bPAYTM\s*MONEY\b/, 'Paytm Money'],
  [/\bINDMONEY\b/, 'INDmoney'],
  [/\bANGEL\s*(ONE|BROKING)\b/, 'Angel One'],
  [/\bNPS\s*TRUST\b|\bNATIONAL\s+PENSION\b/, 'NPS'],
  [/\bPPF\b|\bPUBLIC\s+PROVIDENT\b/, 'PPF'],
  [/\bSUKANYA\b|\bSSY\b/, 'Sukanya Samriddhi'],
  [/\bRECURRING\s+DEPOSIT\b|\bRD\s+(INST|INSTAL)/, 'recurring deposit'],
  [/\bSOVEREIGN\s+GOLD\b|\bSGB\b/, 'Sovereign Gold Bond'],
];

/**
 * Money leaving for an investment is not spending: the rupees still belong to
 * the user. Only a debit can be one — a credit from a fund is a redemption or
 * a dividend, and whether that is income is not something wording can settle.
 */
export const detectInvestment = (
  narration: string,
  isDebit: boolean
): InvestmentDetectionResult => {
  if (!isDebit) return { isInvestment: false };

  const text = narration.toUpperCase();
  for (const [pattern, evidence] of INVESTMENT_WORDING) {
    if (pattern.test(text)) return { isInvestment: true, evidence };
  }
  return { isInvestment: false };
};
