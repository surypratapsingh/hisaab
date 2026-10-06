import { Paise, paise, sum, subtract, add, isNegative } from '@/money/money';
import { daysBetween, shortDate } from '@/lib/date';

export type Commitment = {
  label: string;
  amount: Paise;
  dueDate: string;
};

export type SafeToSpendInput = {
  today: string;
  /** When money is next expected in. Ends the window Safe-to-Spend covers. */
  nextIncomeDate: string;
  liquidBalance: Paise;
  bills: Commitment[];
  cardDues: Commitment[];
  scheduledInvestments: Commitment[];
  /** The balance the user never wants to drop below. */
  cashFloor: Paise;
  /** Typical day-to-day spend, per day, from the user's own history. */
  dailyDiscretionary: Paise;
};

export type SafeToSpendLineKind =
  | 'liquid'
  | 'bill'
  | 'card'
  | 'investment'
  | 'floor'
  | 'forecast';

export type SafeToSpendLine = {
  kind: SafeToSpendLineKind;
  label: string;
  /** Signed: positive adds to the figure, negative takes away from it. */
  amount: Paise;
};

export type SafeToSpend = {
  amount: Paise;
  daysInWindow: number;
  windowEnd: string;
  lines: SafeToSpendLine[];
};

const negate = (amount: Paise): Paise => subtract(paise(0), amount);

const withinWindow = (
  commitments: Commitment[],
  today: string,
  windowEnd: string
): Commitment[] => {
  const start = new Date(today).getTime();
  const end = new Date(windowEnd).getTime();

  return commitments.filter((c) => {
    const due = new Date(c.dueDate).getTime();
    return due >= start && due <= end;
  });
};

/**
 * What is genuinely free to spend before money next arrives.
 *
 * Every deduction is returned as its own line, and the lines always sum to the
 * headline figure. A number the user cannot take apart is a number they stop
 * believing, and the feature dies with it.
 */
export const safeToSpend = (input: SafeToSpendInput): SafeToSpend => {
  const daysInWindow = Math.max(
    0,
    daysBetween(new Date(input.today), new Date(input.nextIncomeDate))
  );

  const lines: SafeToSpendLine[] = [
    { kind: 'liquid', label: 'Across your accounts', amount: input.liquidBalance },
  ];

  for (const bill of withinWindow(input.bills, input.today, input.nextIncomeDate)) {
    lines.push({
      kind: 'bill',
      label: `${bill.label}, due ${shortDate(bill.dueDate)}`,
      amount: negate(bill.amount),
    });
  }

  for (const due of withinWindow(
    input.cardDues,
    input.today,
    input.nextIncomeDate
  )) {
    lines.push({
      kind: 'card',
      label: `${due.label}, due ${shortDate(due.dueDate)}`,
      amount: negate(due.amount),
    });
  }

  for (const sip of withinWindow(
    input.scheduledInvestments,
    input.today,
    input.nextIncomeDate
  )) {
    lines.push({
      kind: 'investment',
      label: `${sip.label}, on ${shortDate(sip.dueDate)}`,
      amount: negate(sip.amount),
    });
  }

  const forecast = paise(input.dailyDiscretionary * daysInWindow);
  if (forecast !== paise(0)) {
    lines.push({
      kind: 'forecast',
      label: `Usual spending for ${daysInWindow} days`,
      amount: negate(forecast),
    });
  }

  if (input.cashFloor !== paise(0)) {
    lines.push({
      kind: 'floor',
      label: 'Your minimum balance',
      amount: negate(input.cashFloor),
    });
  }

  return {
    amount: sum(lines.map((line) => line.amount)),
    daysInWindow,
    windowEnd: input.nextIncomeDate,
    lines,
  };
};

/** True when the window is already overcommitted before any discretionary spend. */
export const isOverCommitted = (result: SafeToSpend): boolean =>
  isNegative(result.amount);

/** Average daily discretionary spend, for seeding the forecast from history. */
export const dailyDiscretionaryFrom = (
  discretionarySpend: Paise[],
  days: number
): Paise => {
  if (days <= 0) return paise(0);
  const total = sum(discretionarySpend.map((amount) => paise(Math.abs(amount))));
  return paise(Math.round(total / days));
};

/** Adds a one-off commitment, e.g. something the user knows is coming. */
export const withCommitment = (
  input: SafeToSpendInput,
  commitment: Commitment
): SafeToSpendInput => ({
  ...input,
  bills: [...input.bills, commitment],
});

export const totalCommitted = (result: SafeToSpend): Paise =>
  sum(
    result.lines
      .filter((line) => line.kind !== 'liquid')
      .map((line) => negate(line.amount))
  );

export const liquidOf = (result: SafeToSpend): Paise =>
  result.lines
    .filter((line) => line.kind === 'liquid')
    .reduce((acc, line) => add(acc, line.amount), paise(0));
