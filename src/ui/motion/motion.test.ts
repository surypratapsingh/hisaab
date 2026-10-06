import { describe, it, expect, beforeEach } from 'vitest';
import { DURATION, LEVELS, PARTICLES } from './tokens';
import { allows, resolveMotion, prefsFromSettings, RewardBudget, DEFAULT_PREFS, type MotionPrefs } from './policy';
import { RULES, emitMoment, onMoment, resetMoments, isFresh, setScreen, getScreen, onScreen, type Moment } from './moments';
import { seeded, seedOf, curve, particleCount, ringPoints, edgePoints, clampToScreen, centerOf, unit } from './paths';
import { countAt, countDuration, direction, easeOut } from './numbers';
import { goalMilestone, goalPercent, netWorthLine, NET_WORTH_LINES } from './milestones';
import { chargeOf, chargeNote, weatherOf } from './battery';
import { classifyNew } from './classify';
import { createFeel, type FeelBackend } from './feelCore';
import type { NewMoney } from '@/repo/moments';
import { orbitLayout, orbitNodes, NODE_MAX, NODE_MIN, type OrbitPart } from './orbit';
import { SCENE_MS, storyOf, type Scene, type StoryInput } from './story';
import { clearCounts, onPlan, peekCount, scheduleCount, startOf, takeCount } from './counting';
import { applyPhone, applyStored, getPrefs, isFollowingPhone, subscribePrefs } from './prefsState';

describe('tokens', () => {
  it('keeps every duration inside its level', () => {
    for (const level of ['micro', 'meaningful', 'cinematic'] as const) {
      for (const [name, ms] of Object.entries(DURATION[level])) {
        expect(ms, `${level}.${name}`).toBeGreaterThanOrEqual(LEVELS[level].min);
        expect(ms, `${level}.${name}`).toBeLessThanOrEqual(LEVELS[level].max);
      }
    }
  });

  it('keeps the levels apart', () => {
    expect(LEVELS.micro.max).toBeLessThan(LEVELS.meaningful.min);
    expect(LEVELS.meaningful.max).toBeLessThanOrEqual(LEVELS.cinematic.min);
  });
});

describe('policy', () => {
  it('lets reduced motion keep fades and figures but not particles, travel, orbit or cinematics', () => {
    expect(allows('reduced', 'fade')).toBe(true);
    expect(allows('reduced', 'amount')).toBe(true);
    for (const effect of ['travel', 'particles', 'orbit', 'cinematic'] as const) {
      expect(allows('reduced', effect)).toBe(false);
    }
  });

  it('lets no motion keep only the change of state', () => {
    expect(allows('none', 'state')).toBe(true);
    expect(allows('none', 'fade')).toBe(false);
    expect(allows('none', 'amount')).toBe(false);
  });

  it('lets full motion do everything', () => {
    for (const effect of ['state', 'fade', 'amount', 'travel', 'particles', 'orbit', 'cinematic'] as const) {
      expect(allows('full', effect)).toBe(true);
    }
  });

  it('follows the phone until a choice is made', () => {
    expect(resolveMotion(null, false)).toBe('full');
    expect(resolveMotion(undefined, true)).toBe('reduced');
    expect(resolveMotion('none', false)).toBe('none');
    expect(resolveMotion('full', true)).toBe('full');
    expect(resolveMotion('nonsense', true)).toBe('reduced');
  });

  it('keeps sound and haptics on unless switched off, each on its own', () => {
    expect(prefsFromSettings({}, false)).toEqual(DEFAULT_PREFS);
    expect(prefsFromSettings({ sound: 'off' }, false)).toEqual({ motion: 'full', sound: false, haptics: true });
    expect(prefsFromSettings({ haptics: 'off' }, false)).toEqual({ motion: 'full', sound: true, haptics: false });
  });
});

describe('reward budget', () => {
  let clock = 0;
  let budget: RewardBudget;
  beforeEach(() => {
    clock = 1_000_000;
    budget = new RewardBudget(() => clock);
  });

  it('keeps sounds apart, one kind apart from itself, and caps them per ten minutes', () => {
    expect(budget.takeSound('success', 5000)).toBe(true);
    clock += 500;
    expect(budget.takeSound('save')).toBe(false); // too soon after any sound
    clock += 1000;
    expect(budget.takeSound('success', 5000)).toBe(false); // same kind, too soon
    expect(budget.takeSound('save')).toBe(true);
    for (let i = 0; i < 20; i++) {
      clock += 1500;
      budget.takeSound(i % 2 ? 'moneyIn' : 'moneyOut');
    }
    clock += 1500;
    expect(budget.takeSound('milestone')).toBe(false); // capped
    clock += 11 * 60_000;
    expect(budget.takeSound('milestone')).toBe(true); // the window has passed
  });

  it('stops haptics chattering', () => {
    expect(budget.takeHaptic('light')).toBe(true);
    clock += 50;
    expect(budget.takeHaptic('light')).toBe(false);
    clock += 100;
    expect(budget.takeHaptic('light')).toBe(true);
  });

  it('spaces cinematics by twenty seconds', () => {
    expect(budget.takeCinematic()).toBe(true);
    clock += 10_000;
    expect(budget.takeCinematic()).toBe(false);
    clock += 11_000;
    expect(budget.takeCinematic()).toBe(true);
  });
});

describe('moment rules', () => {
  it('reserves cinematics for salary, a finished goal and a net-worth line', () => {
    const cinematic = Object.entries(RULES)
      .filter(([, rule]) => rule.level === 'cinematic')
      .map(([type]) => type)
      .sort();
    expect(cinematic).toEqual(['GOAL_COMPLETE', 'NET_WORTH_MILESTONE', 'SALARY_RECEIVED']);
  });

  it('gives ordinary transactions a haptic at most, never a cinematic', () => {
    for (const type of ['EXPENSE_RECORDED', 'INCOME_RECEIVED', 'INVESTED'] as const) {
      expect(RULES[type].level).toBe('meaningful');
    }
  });

  it('lets a moment go stale', () => {
    const moment: Moment = { type: 'EXPENSE_RECORDED', key: 'x', at: 1000 };
    expect(isFresh(moment, 1000 + 19_000)).toBe(true);
    expect(isFresh(moment, 1000 + 25_000)).toBe(false);
    expect(isFresh({ ...moment, type: 'SALARY_RECEIVED' }, 1000 + 3_600_000)).toBe(true);
  });
});

describe('moment bus', () => {
  beforeEach(() => resetMoments());

  it('answers each real event once', () => {
    const heard: string[] = [];
    onMoment((m) => heard.push(m.key));
    emitMoment({ type: 'INCOME_RECEIVED', key: 'a', at: 1 });
    emitMoment({ type: 'INCOME_RECEIVED', key: 'a', at: 2 });
    emitMoment({ type: 'INCOME_RECEIVED', key: 'b', at: 3 });
    expect(heard).toEqual(['a', 'b']);
  });

  it('holds events that arrive before anyone listens', () => {
    emitMoment({ type: 'SALARY_RECEIVED', key: 'early', at: 1 });
    const heard: string[] = [];
    onMoment((m) => heard.push(m.key));
    expect(heard).toEqual(['early']);
  });

  it('tells listeners which screen is in front', () => {
    const seen: string[] = [];
    const stop = onScreen((s) => seen.push(s));
    setScreen('Reports');
    setScreen('Reports');
    setScreen('Home');
    stop();
    setScreen('Activity');
    expect(seen).toEqual(['Reports', 'Home']);
    expect(getScreen()).toBe('Activity');
    setScreen('Home');
  });
});

describe('paths', () => {
  it('draws the same scatter for the same seed', () => {
    const a = ringPoints(seeded(seedOf('e1')), { x: 100, y: 100 }, 12, 60, 120);
    const b = ringPoints(seeded(seedOf('e1')), { x: 100, y: 100 }, 12, 60, 120);
    const c = ringPoints(seeded(seedOf('e2')), { x: 100, y: 100 }, 12, 60, 120);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('keeps ring points between the near and far radius', () => {
    for (const p of ringPoints(seeded(7), { x: 0, y: 0 }, 30, 50, 90)) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThanOrEqual(49.9);
      expect(r).toBeLessThanOrEqual(90.1);
    }
  });

  it('keeps edge points on the screen', () => {
    for (const p of edgePoints(seeded(3), 360, 780, 16)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(360);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(780);
    }
  });

  it('runs a curve from the start to the end', () => {
    const points = curve({ x: 10, y: 20 }, { x: 210, y: 320 }, 0.2, 10);
    expect(points).toHaveLength(11);
    expect(points[0]).toEqual({ x: 10, y: 20 });
    expect(points[10].x).toBeCloseTo(210);
    expect(points[10].y).toBeCloseTo(320);
    expect(unit(10)).toHaveLength(11);
  });

  it('counts between 8 and 20 particles, more on a wider screen', () => {
    expect(particleCount(320)).toBeGreaterThanOrEqual(PARTICLES.min);
    expect(particleCount(1200)).toBe(PARTICLES.max);
    expect(particleCount(100)).toBe(PARTICLES.min);
    expect(particleCount(412)).toBeGreaterThan(particleCount(320) - 1);
  });

  it('keeps a point on the screen and finds a centre', () => {
    expect(clampToScreen({ x: -50, y: 2000 }, 400, 800)).toEqual({ x: 24, y: 776 });
    expect(centerOf({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
  });
});

describe('numbers', () => {
  it('moves whole paise from the old figure to the new one', () => {
    expect(countAt(1000, 2000, 0)).toBe(1000);
    expect(countAt(1000, 2000, 1)).toBe(2000);
    const mid = countAt(1000, 2000, 0.4);
    expect(Number.isInteger(mid)).toBe(true);
    expect(mid).toBeGreaterThan(1000);
    expect(mid).toBeLessThan(2000);
  });

  it('goes down as smoothly as it goes up, never past the ends', () => {
    for (let i = 0; i <= 20; i++) {
      const v = countAt(5000, 1200, i / 20);
      expect(v).toBeLessThanOrEqual(5000);
      expect(v).toBeGreaterThanOrEqual(1200);
    }
  });

  it('eases out: more than half the way in the first half', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it('settles a small change quickly and a large one a little longer, within the level', () => {
    const small = countDuration(0, 5000);
    const large = countDuration(0, 10_000_000);
    expect(small).toBeGreaterThanOrEqual(LEVELS.micro.min);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(LEVELS.meaningful.max);
    expect(countDuration(100, 100)).toBe(DURATION.micro.amount);
  });

  it('says which way a figure moved', () => {
    expect(direction(1, 2)).toBe(1);
    expect(direction(2, 1)).toBe(-1);
    expect(direction(2, 2)).toBe(0);
  });
});

describe('milestones', () => {
  const target = 20_000_00;
  it('finds the goal line crossed by a contribution', () => {
    expect(goalMilestone(0, 4_000_00, target)).toBeUndefined(); // 20%
    expect(goalMilestone(4_000_00, 5_000_00, target)).toBe('GOAL_25');
    expect(goalMilestone(0, 5_000_00, target)).toBe('GOAL_25');
    expect(goalMilestone(5_000_00, 10_000_00, target)).toBe('GOAL_50');
    expect(goalMilestone(10_000_00, 15_000_00, target)).toBe('GOAL_75');
    expect(goalMilestone(15_000_00, 20_000_00, target)).toBe('GOAL_COMPLETE');
  });

  it('answers only the highest line one change crossed', () => {
    expect(goalMilestone(0, 16_000_00, target)).toBe('GOAL_75');
    expect(goalMilestone(0, 30_000_00, target)).toBe('GOAL_COMPLETE');
  });

  it('says nothing for a move down, a move within a band, or a goal already met', () => {
    expect(goalMilestone(10_000_00, 6_000_00, target)).toBeUndefined();
    expect(goalMilestone(5_500_00, 9_000_00, target)).toBeUndefined();
    expect(goalMilestone(20_000_00, 25_000_00, target)).toBeUndefined();
    expect(goalMilestone(0, 1000, 0)).toBeUndefined();
  });

  it('caps the percent at 100', () => {
    expect(goalPercent(40_000_00, target)).toBe(100);
    expect(goalPercent(0, 0)).toBe(0);
  });

  it('finds the net-worth line under a total', () => {
    expect(NET_WORTH_LINES[0]).toBe(10_000_000);
    expect(netWorthLine(2_562_692)).toBe(0);
    expect(netWorthLine(10_000_000)).toBe(10_000_000);
    expect(netWorthLine(74_000_000)).toBe(50_000_000);
    expect(netWorthLine(10_000_000_000)).toBe(NET_WORTH_LINES[NET_WORTH_LINES.length - 1]);
  });
});

describe('charge and weather', () => {
  it('reads the free share of the balance as green, amber or red', () => {
    expect(chargeOf(720, 1000)).toEqual({ fraction: 0.72, state: 'green' });
    expect(chargeOf(200, 1000).state).toBe('amber');
    expect(chargeOf(50, 1000).state).toBe('red');
    expect(chargeOf(5000, 1000)).toEqual({ fraction: 1, state: 'green' });
  });

  it('is empty and red with nothing free or nothing held', () => {
    expect(chargeOf(-300, 1000)).toEqual({ fraction: 0, state: 'red' });
    expect(chargeOf(300, 0)).toEqual({ fraction: 0, state: 'red' });
  });

  it('describes the state and never advises', () => {
    for (const state of ['green', 'amber', 'red'] as const) {
      expect(chargeNote(state)).not.toMatch(/should|must|stop|cut|avoid|save more/i);
    }
    expect(chargeNote('red')).toBe('Your remaining spending room is getting tighter.');
  });

  it('has no weather without a picture of the money', () => {
    expect(weatherOf({ dueSoon: 0, overBudgets: 0 })).toBe('normal');
  });

  it('is healthy when plenty is free, pressured when little is, heavy when much is due', () => {
    expect(weatherOf({ charge: chargeOf(800, 1000), free: 800, dueSoon: 0, overBudgets: 0 })).toBe('healthy');
    expect(weatherOf({ charge: chargeOf(-10, 1000), free: -10, dueSoon: 0, overBudgets: 0 })).toBe('pressure');
    expect(weatherOf({ charge: chargeOf(50, 1000), free: 50, dueSoon: 0, overBudgets: 0 })).toBe('pressure');
    expect(weatherOf({ charge: chargeOf(600, 1000), free: 600, dueSoon: 400, overBudgets: 0 })).toBe('commitments');
    expect(weatherOf({ charge: chargeOf(600, 1000), free: 600, dueSoon: 100, overBudgets: 0 })).toBe('healthy');
    expect(weatherOf({ charge: chargeOf(600, 1000), free: 600, dueSoon: 0, overBudgets: 1 })).toBe('normal');
  });
});

describe('classifyNew', () => {
  const row = (over: Partial<NewMoney>): NewMoney => ({
    id: 'e1',
    kind: 'expense',
    occurredAt: '2026-09-29',
    createdAt: '2026-09-29T09:00:00.000Z',
    net: -129_900,
    outflow: 129_900,
    ...over,
  });
  const context = { largestSalary: 0, salaryAnswered: () => false };

  it('turns an expense into an outflow moment with its size and category', () => {
    const [m] = classifyNew([row({ category: 'Shopping' })], context);
    expect(m).toMatchObject({ type: 'EXPENSE_RECORDED', amount: 129_900, label: 'Shopping', key: 'EXPENSE_RECORDED:e1' });
  });

  it('calls a large credit filed under Salary a salary', () => {
    const [m] = classifyNew([row({ kind: 'income', categoryId: 'cat_salary', net: 6_800_000, outflow: 0 })], context);
    expect(m.type).toBe('SALARY_RECEIVED');
    expect(m.amount).toBe(6_800_000);
  });

  it('calls a small credit filed under Salary plain income when there is no salary to compare with', () => {
    const [m] = classifyNew([row({ kind: 'income', categoryId: 'cat_salary', net: 20_000, outflow: 0 })], context);
    expect(m.type).toBe('INCOME_RECEIVED');
  });

  it('compares with the biggest salary so far', () => {
    const ctx = { ...context, largestSalary: 6_000_000 };
    const big = classifyNew([row({ kind: 'income', categoryId: 'cat_salary', net: 3_000_000, outflow: 0 })], ctx);
    const small = classifyNew([row({ kind: 'income', categoryId: 'cat_salary', net: 2_999_999, outflow: 0 })], ctx);
    expect(big[0].type).toBe('SALARY_RECEIVED');
    expect(small[0].type).toBe('INCOME_RECEIVED');
  });

  it('does not answer a salary twice (a hand-typed entry, then the bank message)', () => {
    const ctx = { ...context, salaryAnswered: () => true };
    expect(classifyNew([row({ kind: 'income', categoryId: 'cat_salary', net: 6_800_000, outflow: 0 })], ctx)).toEqual([]);
  });

  it('answers an investment by the money that left', () => {
    const [m] = classifyNew([row({ kind: 'investment', net: 0, outflow: 500_000 })], context);
    expect(m).toMatchObject({ type: 'INVESTED', amount: 500_000 });
  });

  it('ignores transfers', () => {
    expect(classifyNew([row({ kind: 'transfer', net: 0, outflow: 100 })], context)).toEqual([]);
  });

  it('treats a batch of entries as an import, not a moment', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ id: `e${i}` }));
    expect(classifyNew(rows, context)).toEqual([]);
  });

  it('treats an entry dated long before it arrived as history', () => {
    expect(classifyNew([row({ occurredAt: '2026-08-01' })], context)).toEqual([]);
    expect(classifyNew([row({ occurredAt: '2026-09-27' })], context)).toHaveLength(1);
  });

  it('keeps the largest of each kind when several arrive together', () => {
    const out = classifyNew(
      [row({ id: 'a', net: -1000 }), row({ id: 'b', net: -9000 }), row({ id: 'c', kind: 'income', net: 500, outflow: 0 })],
      context
    );
    expect(out.map((m) => m.key).sort()).toEqual(['EXPENSE_RECORDED:b', 'INCOME_RECEIVED:c']);
  });
});

describe('feel', () => {
  const setup = (prefs: Partial<MotionPrefs> = {}) => {
    const played: string[] = [];
    const backend: FeelBackend = {
      haptic: (k) => (played.push(`h:${k}`), true),
      tone: (n) => (played.push(`s:${n}`), true),
    };
    let clock = 0;
    const later: Array<() => void> = [];
    const feel = createFeel(
      backend,
      () => ({ ...DEFAULT_PREFS, ...prefs }),
      new RewardBudget(() => clock),
      (_ms, then) => void later.push(then)
    );
    return { feel, played, tick: (ms: number) => (clock += ms), flush: () => later.splice(0).forEach((f) => f()) };
  };

  it('plays nothing when the haptics or sound switch is off, each on its own', () => {
    const a = setup({ haptics: false });
    a.feel.haptic('light');
    a.feel.sound('success');
    expect(a.played).toEqual(['s:success']);

    const b = setup({ sound: false });
    b.feel.haptic('light');
    b.feel.sound('success');
    expect(b.played).toEqual(['h:light']);
  });

  it('plays the feel of a rule: two haptics one after the other, then the sound', () => {
    const t = setup();
    t.feel.forRule(RULES.SALARY_RECEIVED);
    expect(t.played).toEqual(['h:medium', 's:moneyIn']);
    t.tick(200);
    t.flush();
    expect(t.played).toEqual(['h:medium', 's:moneyIn', 'h:success']);
  });

  it('keeps a repeated sound quiet', () => {
    const t = setup();
    t.feel.forRule(RULES.EXPENSE_RECORDED);
    t.tick(3000);
    t.feel.forRule(RULES.EXPENSE_RECORDED);
    expect(t.played.filter((p) => p.startsWith('s:'))).toEqual(['s:moneyOut']);
  });

  it('warns without a sound and errors softly', () => {
    const t = setup();
    t.feel.warn();
    t.tick(500);
    t.feel.error();
    expect(t.played).toEqual(['h:warning', 'h:warning', 's:error']);
  });
});

describe('count plans', () => {
  beforeEach(() => clearCounts());

  it('offers a plan once, and starts it from the value it will end on less the amount', () => {
    scheduleCount('wealth', { back: 680_000, delayMs: 820 }, 1000);
    const peeked = peekCount('wealth', 2000);
    expect(peeked).toBeDefined();
    expect(startOf(peeked!, 2_562_692)).toBe(1_882_692);
    expect(takeCount('wealth', 2000)).toBeDefined();
    expect(takeCount('wealth', 2000)).toBeUndefined();
  });

  it('lets a plan lapse', () => {
    scheduleCount('wealth', { back: 100, delayMs: 0 }, 1000, 5000);
    expect(peekCount('wealth', 7000)).toBeUndefined();
  });

  it('tells a figure that is already showing that a plan arrived', () => {
    let calls = 0;
    const stop = onPlan('wealth', () => (calls += 1));
    scheduleCount('wealth', { back: 1, delayMs: 0 });
    scheduleCount('other', { back: 1, delayMs: 0 });
    stop();
    scheduleCount('wealth', { back: 1, delayMs: 0 });
    expect(calls).toBe(1);
  });
});

describe('prefs state', () => {
  it('follows the phone until a choice is made, and says so', () => {
    applyStored({ motion: null, sound: null, haptics: null });
    applyPhone(true);
    expect(getPrefs().motion).toBe('reduced');
    expect(isFollowingPhone()).toBe(true);
    applyStored({ motion: 'full', sound: null, haptics: null });
    expect(getPrefs().motion).toBe('full');
    expect(isFollowingPhone()).toBe(false);
    applyStored({ motion: null, sound: 'off', haptics: 'off' });
    expect(getPrefs()).toEqual({ motion: 'reduced', sound: false, haptics: false });
    applyPhone(false);
    applyStored({ motion: null, sound: null, haptics: null });
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('tells listeners when something changed, and only then', () => {
    applyStored({ motion: null, sound: null, haptics: null });
    applyPhone(false);
    let calls = 0;
    const stop = subscribePrefs(() => (calls += 1));
    applyStored({ motion: null, sound: null, haptics: null });
    expect(calls).toBe(0);
    applyStored({ motion: 'none', sound: null, haptics: null });
    expect(calls).toBe(1);
    stop();
    applyStored({ motion: null, sound: null, haptics: null });
    expect(calls).toBe(1);
  });
});

describe('monthly story', () => {
  const input: StoryInput = {
    monthName: 'September',
    year: '2026',
    received: 6_800_000,
    spent: 2_438_000,
    transactions: 96,
    categories: [
      { name: 'Food & Dining', amount: 632_000, percentage: 26 },
      { name: 'Bills', amount: 500_000, percentage: 21 },
      { name: 'Shopping', amount: 400_000, percentage: 16 },
      { name: 'Groceries', amount: 300_000, percentage: 12 },
      { name: 'Transport', amount: 200_000, percentage: 8 },
    ],
  };

  it('runs received, streams, spent, left over, summary, in under eight seconds and over five', () => {
    const scenes = storyOf(input);
    expect(scenes.map((s) => s.key)).toEqual(['received', 'streams', 'spent', 'kept', 'summary']);
    const totalMs = scenes.reduce((sum, scene) => sum + SCENE_MS[scene.key], 0);
    expect(totalMs).toBeGreaterThanOrEqual(5000);
    expect(totalMs).toBeLessThanOrEqual(8000);
  });

  it('shows the four biggest categories in the streams', () => {
    const streams = storyOf(input).find((s) => s.key === 'streams');
    expect(streams && 'rows' in streams && streams.rows.map((r) => r.name)).toEqual(['Food & Dining', 'Bills', 'Shopping', 'Groceries']);
  });

  it('says what was left over, or how much more went out, without advice', () => {
    const kept = storyOf(input).find((s) => s.key === 'kept');
    expect(kept).toMatchObject({ amount: 4_362_000, positive: true, line: 'left after what went out' });
    const over = storyOf({ ...input, received: 1_000_000 }).find((s) => s.key === 'kept');
    expect(over).toMatchObject({ amount: 1_438_000, positive: false, line: 'more went out than came in' });
    for (const scene of storyOf({ ...input, received: 1_000_000 })) {
      const text = JSON.stringify(scene);
      expect(text).not.toMatch(/should|must|try to|consider|cut back|save more|good job|well done/i);
    }
  });

  it('leaves out a scene with nothing behind it', () => {
    expect(storyOf({ ...input, received: 0 }).map((s) => s.key)).toEqual(['streams', 'spent', 'kept', 'summary']);
    expect(storyOf({ ...input, spent: 0, categories: [] }).map((s) => s.key)).toEqual(['received', 'kept', 'summary']);
    expect(storyOf({ ...input, received: 0, spent: 0, categories: [], transactions: 0 }).map((s) => s.key)).toEqual(['summary']);
  });

  it('counts the transactions in the summary, singular or plural', () => {
    const summary = (n: number) => storyOf({ ...input, transactions: n }).find((s) => s.key === 'summary');
    expect(summary(96)).toMatchObject({ kicker: 'YOUR SEPTEMBER' });
    const lines = (n: number) => (summary(n) as Extract<Scene, { key: 'summary' }>).lines.map((l) => l.text);
    expect(lines(96)[0]).toBe('You tracked 96 transactions.');
    expect(lines(1)[0]).toBe('You tracked 1 transaction.');
    expect(lines(96)).toContain('Food & Dining was your largest category.');
  });
});

describe('wealth orbit', () => {
  const parts: OrbitPart[] = [
    { kind: 'bank', value: 2_000_000 },
    { kind: 'bank', value: 392_692 },
    { kind: 'investment', value: 170_000 },
    { kind: 'cash', value: 0 },
    { kind: 'bank', value: 999_999, unknown: true },
  ];

  it('adds each kind up, leaves out what is not known or empty, and keeps a fixed order', () => {
    const nodes = orbitNodes(parts);
    expect(nodes.map((n) => [n.kind, n.value])).toEqual([
      ['investment', 170_000],
      ['bank', 2_392_692],
    ]);
    expect(nodes.reduce((sum, n) => sum + n.share, 0)).toBeCloseTo(1);
  });

  it('has nothing to draw with nothing counted', () => {
    expect(orbitNodes([])).toEqual([]);
    expect(orbitNodes([{ kind: 'bank', value: 5, unknown: true }])).toEqual([]);
  });

  it('sizes by share within limits, and sits a bigger share closer in', () => {
    const places = orbitLayout(orbitNodes(parts));
    const [invest, bank] = places;
    expect(invest.size).toBeGreaterThanOrEqual(NODE_MIN);
    expect(bank.size).toBeLessThanOrEqual(NODE_MAX);
    expect(bank.size).toBeGreaterThan(invest.size);
    expect(bank.radius).toBeLessThan(invest.radius);
    expect(invest.angle).toBe(-90);
    expect(bank.angle).toBe(180);
  });

  it('changes size and distance when one part grows, and only that part moves its place', () => {
    const before = orbitLayout(orbitNodes(parts));
    const after = orbitLayout(orbitNodes(parts.map((p) => (p.kind === 'investment' ? { ...p, value: 900_000 } : p))));
    expect(after[0].size).toBeGreaterThan(before[0].size);
    expect(after[0].angle).toBe(before[0].angle);
    expect(after[1].size).toBeLessThan(before[1].size);
  });
});
