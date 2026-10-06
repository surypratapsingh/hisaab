export const normalise = (narration: string): string => {
  let normalized = narration
    .toUpperCase()
    .trim()
    .replace(/^UPI\//i, '')
    .replace(/^NEFT\//i, '')
    .replace(/^IMPS\//i, '')
    .replace(/^POS\s+/i, '')
    .replace(/\s{2,}/g, ' ') // Collapse whitespace
    .replace(/\d{4}-\d{2}-\d{2}/g, '') // Remove dates
    .replace(/-{2,}/g, '') // Remove -- padding
    .trim();

  // Remove common suffixes
  normalized = normalized
    .replace(/\s+REF\s+\d+$/, '')
    .replace(/\s+TXN\s+\d+$/, '')
    .replace(/\s+ORD\s+\d+$/, '');

  return normalized;
};

export const extractVPA = (narration: string): string | null => {
  const vpaRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/;
  const match = narration.match(vpaRegex);
  return match ? match[1].toLowerCase() : null;
};

export const extractMerchantName = (narration: string): string => {
  // Try to extract known patterns
  const patterns = [
    /^([A-Z][A-Z\s]+?)(?:\s+(?:UPI|PAYMENT|PURCHASE|TXN))?$/,
    /^(\w+\/\w+)/, // Company/Item pattern
    /^([A-Z]+\s+[A-Z]+)/, // Two-word company names
  ];

  for (const pattern of patterns) {
    const match = narration.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return narration.split(/[\s/]/).slice(0, 2).join(' ');
};
