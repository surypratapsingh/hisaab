/**
 * The monthly story: a few short scenes that tell what a month was, from
 * figures the report already has. Descriptive only. It says what came in, what
 * went out, what was left, and which category was largest; it never says what
 * to do about any of it. A scene with nothing behind it is left out.
 */

export type StoryInput = {
  /** "September". */
  monthName: string;
  year: string;
  /** Whole paise. */
  received: number;
  spent: number;
  transactions: number;
  /** Spending categories, largest first. */
  categories: Array<{ name: string; amount: number; percentage: number }>;
};

export type Scene =
  | { key: 'received'; kicker: string; amount: number; line: string }
  | { key: 'streams'; line: string; rows: Array<{ name: string; amount: number; percentage: number }> }
  | { key: 'spent'; amount: number; line: string }
  | { key: 'kept'; amount: number; positive: boolean; line: string }
  /** `{amount}` in a line stands for `amount`, formatted (or hidden) by the screen. */
  | { key: 'summary'; kicker: string; lines: Array<{ text: string; amount?: number }> };

export type SceneKey = Scene['key'];

/** How long each scene stays, in ms. All five come to just under eight seconds. */
export const SCENE_MS: Record<SceneKey, number> = { received: 1500, streams: 1700, spent: 1200, kept: 1400, summary: 2000 };

const STREAM_ROWS = 4;

export const storyOf = (input: StoryInput): Scene[] => {
  const { received, spent, categories, transactions, monthName } = input;
  const scenes: Scene[] = [];

  if (received > 0) {
    scenes.push({ key: 'received', kicker: `${monthName.toUpperCase()} ${input.year}`, amount: received, line: 'came in' });
  }
  if (spent > 0 && categories.length > 0) {
    scenes.push({ key: 'streams', line: 'went out into', rows: categories.slice(0, STREAM_ROWS) });
  }
  if (spent > 0) {
    scenes.push({ key: 'spent', amount: spent, line: 'spent in all' });
  }
  if (received > 0 || spent > 0) {
    const positive = received >= spent;
    scenes.push({
      key: 'kept',
      amount: Math.abs(received - spent),
      positive,
      line: positive ? 'left after what went out' : 'more went out than came in',
    });
  }

  const lines: Array<{ text: string; amount?: number }> = [
    { text: `You tracked ${transactions} ${transactions === 1 ? 'transaction' : 'transactions'}.` },
  ];
  if (categories[0]) lines.push({ text: `${categories[0].name} was your largest category.` });
  if (received > 0 || spent > 0) {
    lines.push(
      received >= spent
        ? { text: '{amount} was left after spending.', amount: received - spent }
        : { text: 'You spent {amount} more than came in.', amount: spent - received }
    );
  }
  scenes.push({ key: 'summary', kicker: `YOUR ${monthName.toUpperCase()}`, lines });

  return scenes;
};
