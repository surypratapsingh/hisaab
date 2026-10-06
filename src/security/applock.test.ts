import { describe, it, expect } from 'vitest';
import {
  RELOCK_AFTER_MS,
  initialLockState,
  onBackground,
  onForeground,
  unlock,
  runCheck,
  type Authenticator,
  type Check,
  type CheckOptions,
} from './applock';

const fake = (security: 'secured' | 'unsecured', passes: boolean | Error): Authenticator => ({
  security: async () => security,
  authenticate: async () => {
    if (passes instanceof Error) throw passes;
    return passes;
  },
});

describe('app lock', () => {
  it('starts locked', () => {
    expect(initialLockState().locked).toBe(true);
  });

  it('stays unlocked after a short trip to the background', () => {
    const open = { locked: false, backgroundedAt: null };
    const away = onBackground(open, 1_000);
    expect(onForeground(away, 1_000 + RELOCK_AFTER_MS - 1)).toEqual({
      locked: false,
      backgroundedAt: null,
    });
  });

  it('locks again after the grace period', () => {
    const away = onBackground({ locked: false, backgroundedAt: null }, 0);
    expect(onForeground(away, RELOCK_AFTER_MS).locked).toBe(true);
  });

  it('keeps the first background time when backgrounded twice', () => {
    const once = onBackground({ locked: false, backgroundedAt: null }, 0);
    expect(onBackground(once, 50_000).backgroundedAt).toBe(0);
  });

  it('never unlocks on foreground alone', () => {
    const away = onBackground(initialLockState(), 0);
    expect(onForeground(away, 1).locked).toBe(true);
  });

  it('ignores a foreground event with no background before it', () => {
    const s = { locked: false, backgroundedAt: null };
    expect(onForeground(s, 999_999)).toBe(s);
  });

  it('unlocks on a passed check', async () => {
    expect((await unlock(fake('secured', true))).getOrThrow()).toBe('unlocked');
  });

  it('stays locked on a failed or cancelled check', async () => {
    expect((await unlock(fake('secured', false))).getOrThrow()).toBe('denied');
  });

  it('reports a phone with no screen lock without prompting', async () => {
    let prompted = false;
    const auth: Authenticator = {
      security: async () => 'unsecured',
      authenticate: async () => (prompted = true),
    };
    expect((await unlock(auth)).getOrThrow()).toBe('unsecured');
    expect(prompted).toBe(false);
  });

  it('returns an error instead of unlocking when the check throws', async () => {
    const r = await unlock(fake('secured', new Error('sensor busy')));
    expect(r.isErr()).toBe(true);
  });
});

describe('runCheck', () => {
  // A clock that reads 1s later each time: whoever answered took their time, as a person does.
  const slow = () => {
    let t = 0;
    return () => (t += 1000);
  };
  const passes = async (): Promise<Check> => ({ success: true });
  const says = (error: string) => async (): Promise<Check> => ({ success: false, error });
  const noReset = async () => {};
  const run = (attempt: () => Promise<Check>, reset: () => Promise<void>, more: CheckOptions = {}) =>
    runCheck(attempt, reset, { settleMs: 0, ...more });

  it('passes what the phone passes and refuses what it refuses', async () => {
    expect(await run(passes, noReset, { now: slow() })).toBe(true);
    expect(await run(says('user_cancel'), noReset, { now: slow() })).toBe(false);
    expect(await run(says('lockout'), noReset, { now: slow() })).toBe(false);
  });

  it('does not take a success that came back at once: no person could have touched the sensor', async () => {
    let cleared = 0;
    // The clock never moves, so every answer is instant.
    expect(await run(passes, async () => void cleared++, { now: () => 5 })).toBe(false);
    expect(cleared).toBe(2); // cleared after each stale answer
  });

  it('asks again after a stale success, and takes the real one that follows', async () => {
    let calls = 0;
    let time = 0;
    const attempt = async (): Promise<Check> => {
      calls++;
      time += calls === 1 ? 5 : 4000; // the first answer is instant, the second took a while
      return { success: true };
    };
    expect(await run(attempt, noReset, { now: () => time })).toBe(true);
    expect(calls).toBe(2);
  });

  it('clears a prompt the phone wrongly thinks is open, then asks again', async () => {
    let calls = 0;
    let cleared = 0;
    const attempt = async (): Promise<Check> => (++calls === 1 ? { success: false, error: 'app_cancel' } : { success: true });
    expect(await run(attempt, async () => void cleared++, { now: slow() })).toBe(true);
    expect(calls).toBe(2);
    expect(cleared).toBe(1);
  });

  it('asks only once more, and leaves the phone cleared if that also fails', async () => {
    let calls = 0;
    let cleared = 0;
    const attempt = async (): Promise<Check> => (++calls, { success: false, error: 'app_cancel' });
    expect(await run(attempt, async () => void cleared++, { now: slow() })).toBe(false);
    expect(calls).toBe(2);
    expect(cleared).toBe(2);
  });

  it('does not clear anything when the user simply said no', async () => {
    let cleared = 0;
    await run(says('user_cancel'), async () => void cleared++, { now: slow() });
    expect(cleared).toBe(0);
  });

  it('gives up on a prompt that never answers, and clears it', async () => {
    let cleared = 0;
    const never = () => new Promise<Check>(() => {});
    expect(await run(never, async () => void cleared++, { timeoutMs: 20 })).toBe(false);
    expect(cleared).toBe(1);
  });

  it('carries a thrown error through instead of unlocking', async () => {
    await expect(
      runCheck(async () => { throw new Error('sensor busy'); }, noReset, { now: slow() })
    ).rejects.toThrow('sensor busy');
  });

  it('survives a reset that itself fails', async () => {
    let calls = 0;
    const attempt = async (): Promise<Check> => (++calls === 1 ? { success: false, error: 'app_cancel' } : { success: true });
    expect(
      await run(attempt, async () => { throw new Error('nothing to cancel'); }, { now: slow() })
    ).toBe(true);
  });
});
