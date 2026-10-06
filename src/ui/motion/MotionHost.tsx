import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import { paise } from '@/money/money';
import { useAmount, useInk } from '../kit';
import { measureAnchor, measureFirst } from './anchors';
import { scheduleCount } from './counting';
import { BackupFx, BurstFx, CompleteFx, InflowFx, InvestFx, NoteFx, OutflowFx, SalaryFx, SaveFx } from './effects';
import { RULES, getScreen, isFresh, onMoment, onScreen, type Moment } from './moments';
import { particleCount, seedOf, centerOf, clampToScreen, type Point, type Rect } from './paths';
import { allows } from './policy';
import { applyPhone, getPrefs } from './prefsState';
import { feel } from './runtime';
import { DURATION } from './tokens';

/** Moments that are about the wealth figure, and so wait for the Home screen. */
const NEEDS_HOME = new Set<Moment['type']>(['SALARY_RECEIVED', 'INCOME_RECEIVED', 'EXPENSE_RECORDED', 'INVESTED', 'NET_WORTH_MILESTONE']);

type Active = { id: number; node: (done: () => void) => React.ReactNode };

/**
 * The one place Money Moments are answered. It listens for what happened,
 * decides from the rules and the user's motion settings what to play, finds
 * where things are on screen, and mounts a short effect that removes itself.
 * It draws over the whole app and never takes a touch.
 */
export const MotionHost: React.FC = () => {
  const { width, height } = useWindowDimensions();
  const { colors } = useInk();
  const show = useAmount();
  const rootRef = useRef<View>(null);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const [active, setActive] = useState<Active[]>([]);
  const waiting = useRef<Moment[]>([]);
  const counter = useRef(0);

  // The functions below run from listeners set up once, so they read the latest values here.
  const latest = useRef({ width, height, colors, show });
  latest.current = { width, height, colors, show };

  // The phone's own "remove animations" setting is the default until the user chooses.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(applyPhone, () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', applyPhone);
    return () => sub.remove();
  }, []);

  const measureOrigin = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  }, []);

  const mount = useCallback((node: Active['node']) => {
    const id = (counter.current += 1);
    setActive((list) => [...list, { id, node }]);
  }, []);
  const done = useCallback((id: number) => setActive((list) => list.filter((a) => a.id !== id)), []);

  /** Window coordinates to this overlay's own. */
  const local = (rect: Rect): Rect => ({ ...rect, x: rect.x - origin.current.x, y: rect.y - origin.current.y });

  /** An anchor's place, waiting a little for a screen that is still appearing. */
  const find = async (keys: string[], waitMs = 0, inView = false): Promise<Rect | null> => {
    const until = Date.now() + waitMs;
    // "In view" leaves out what has scrolled off, or sits under the tab bar.
    const seen = (rect: Rect) => rect.y >= 0 && rect.y + rect.height <= latest.current.height - 96;
    for (;;) {
      const rect = await measureFirst(keys, inView ? seen : undefined);
      if (rect) return local(rect);
      if (Date.now() >= until) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  const play = async (moment: Moment) => {
    const rule = RULES[moment.type];
    const { width: w, height: h, colors: c, show: money } = latest.current;
    const mode = getPrefs().motion;
    const seed = seedOf(moment.key);
    const amountText = moment.amount !== undefined ? money(paise(moment.amount)) : '';
    const plain = allows(mode, 'travel');
    measureOrigin();

    // A cinematic is rare; if one just played, this is answered by its smaller sibling.
    const grand = rule.level === 'cinematic' && allows(mode, 'cinematic') && feel.cinematicAllowed();
    feel.forRule(rule);

    const settle = (fx: (done: () => void) => React.ReactNode) => mount((finish) => fx(finish));
    const base = (finish: () => void) => ({ seed, colors: c, onDone: finish });

    switch (rule.effect) {
      case 'salary': {
        if (mode !== 'none') {
          // The hero holds its old figure while the particles gather, then counts up to the new one.
          scheduleCount('wealth', { back: moment.amount ?? 0, delayMs: grand ? 820 : 0, durationMs: grand ? 950 : undefined });
        }
        if (grand) {
          const hero = (await find(['hero'], 2500)) ?? { x: w / 2 - 100, y: h * 0.2, width: 200, height: 48 };
          settle((finish) => (
            <SalaryFx {...base(finish)} hero={hero} width={w} height={h} headline="Salary received" detail={amountText} />
          ));
        } else if (plain) {
          const target = centerOf((await find(['hero'], 800)) ?? { x: w / 2, y: h * 0.2, width: 0, height: 0 });
          settle((finish) => <InflowFx {...base(finish)} target={target} count={particleCount(w, 0.6)} />);
        } else if (allows(mode, 'fade')) {
          settle((finish) => <NoteFx {...base(finish)} width={w} height={h} text={`Salary received  ${amountText}`} />);
        }
        return;
      }
      case 'inflow': {
        if (!plain) return;
        const target = centerOf((await find(['hero'], 800)) ?? { x: w / 2, y: h * 0.2, width: 0, height: 0 });
        settle((finish) => <InflowFx {...base(finish)} target={target} count={particleCount(w, 0.5)} />);
        return;
      }
      case 'outflow': {
        if (!plain) return;
        const source = centerOf((await find(['hero'], 800)) ?? { x: w / 2, y: h * 0.2, width: 0, height: 0 });
        // Where it landed: its category if that is showing, else this month's Spent, else the recent list.
        const found = await find([`category:${moment.label ?? ''}`, 'spent', 'recent'], 0, true);
        // A destination scrolled out of view is reached at the screen's edge, in its direction.
        const to = clampToScreen(found ? centerOf(found) : { x: w / 2, y: h - 130 }, w, h - 90, 30);
        const label = `${moment.label ?? 'Spent'}  −${amountText}`;
        settle((finish) => <OutflowFx {...base(finish)} from={source} to={to} label={label} />);
        return;
      }
      case 'invest': {
        if (!plain) return;
        const source = centerOf((await find(['hero'], 800)) ?? { x: w / 2, y: h * 0.2, width: 0, height: 0 });
        const tile = await find(['invest', 'hero']);
        const target = tile ? centerOf(tile) : source;
        settle((finish) => <InvestFx {...base(finish)} from={source} target={target} />);
        return;
      }
      case 'save': {
        if (!plain) return;
        const goal = await find([`goal:${moment.ref ?? ''}`]);
        if (!goal) return;
        settle((finish) => <SaveFx {...base(finish)} target={goal} />);
        return;
      }
      case 'milestone': {
        if (!plain) return;
        const goal = await find([`goal:${moment.ref ?? ''}`], 800);
        const center = goal ? { x: goal.x + goal.width - 30, y: goal.y + 30 } : { x: w / 2, y: h * 0.4 };
        settle((finish) => <BurstFx {...base(finish)} center={center} count={8} tone="accent" />);
        return;
      }
      case 'complete':
      case 'networth': {
        const kicker = rule.effect === 'complete' ? 'GOAL COMPLETE' : 'NET WORTH';
        const title = rule.effect === 'complete' ? (moment.label ?? 'Goal') : amountText;
        const detail = rule.effect === 'complete' ? amountText : 'A new milestone';
        if (grand) {
          settle((finish) => <CompleteFx {...base(finish)} width={w} height={h} kicker={kicker} title={title} detail={detail} />);
        } else if (allows(mode, 'fade')) {
          settle((finish) => (
            <NoteFx {...base(finish)} width={w} height={h} text={rule.effect === 'complete' ? `Goal complete · ${title}` : `Net worth · ${amountText}`} />
          ));
        }
        return;
      }
      case 'review': {
        if (!plain) return;
        const chosen = await find(['reviewed']);
        const center = chosen ? centerOf(chosen) : { x: w / 2, y: h * 0.35 };
        settle((finish) => <BurstFx {...base(finish)} center={center} count={4} duration={DURATION.meaningful.review} />);
        return;
      }
      case 'budget': {
        if (!plain) return;
        const card = await find([`budget:${moment.ref ?? ''}`], 800);
        const center = card ? { x: card.x + card.width - 30, y: card.y + 30 } : { x: w / 2, y: h * 0.4 };
        settle((finish) => <BurstFx {...base(finish)} center={center} count={8} tone="accent" />);
        return;
      }
      case 'backup': {
        if (plain) settle((finish) => <BackupFx {...base(finish)} width={w} height={h} />);
        else if (allows(mode, 'fade')) settle((finish) => <NoteFx {...base(finish)} width={w} height={h} text="Backed up" />);
        return;
      }
    }
  };

  const handle = (moment: Moment) => {
    if (!isFresh(moment, Date.now())) return;
    if (NEEDS_HOME.has(moment.type) && getScreen() !== 'Home') {
      waiting.current = [...waiting.current, moment].slice(-6);
      return;
    }
    void play(moment);
  };

  useEffect(() => onMoment(handle), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Something that arrived while another screen was in front is answered when Home is back,
  // if it is still recent enough to mean anything.
  useEffect(
    () =>
      onScreen((screen) => {
        if (screen !== 'Home' || waiting.current.length === 0) return;
        const list = waiting.current.filter((m) => isFresh(m, Date.now()));
        waiting.current = [];
        // Let Home finish drawing before anything is measured.
        setTimeout(() => list.forEach((m) => void play(m)), 250);
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <View ref={rootRef} pointerEvents="none" collapsable={false} onLayout={measureOrigin} style={StyleSheet.absoluteFill}>
      {active.map((a) => (
        <React.Fragment key={a.id}>{a.node(() => done(a.id))}</React.Fragment>
      ))}
    </View>
  );
};

export { measureAnchor };
