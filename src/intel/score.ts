export type ConfidenceScore = {
  overall: number;
  merchant: number;
  category: number;
  transfer: number;
  shouldReview: boolean;
};

export const calculateConfidence = (
  merchantConfidence: number,
  categoryConfidence: number,
  transferConfidence: number,
  threshold: number = 0.7
): ConfidenceScore => {
  // Weighted average
  const overall =
    merchantConfidence * 0.4 +
    categoryConfidence * 0.4 +
    transferConfidence * 0.2;

  return {
    overall: Math.min(1, Math.max(0, overall)),
    merchant: merchantConfidence,
    category: categoryConfidence,
    transfer: transferConfidence,
    shouldReview: overall < threshold,
  };
};

export const scoreTransaction = (
  isTransfer: boolean,
  merchantResolved: boolean,
  merchantConfidence: number,
  categoryConfidence: number
): ConfidenceScore => {
  const transferConf = isTransfer ? 1.0 : 0;
  const merchantConf = merchantResolved ? merchantConfidence : 0.1;

  return calculateConfidence(merchantConf, categoryConfidence, transferConf);
};
