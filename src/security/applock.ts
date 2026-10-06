import { Result, ok, err } from '@/lib/result';

/**
 * App lock backed by the phone's own security: biometrics, falling back to the
 * device PIN, pattern or password. The app never stores a secret of its own.
 *
 * The device calls sit behind `Authenticator` so the lock rules can be tested
 * without a phone.
 */

export type DeviceSecurity =
  /** Biometrics or a screen lock is set up; the app can be locked. */
  | 'secured'
  /** The phone has no screen lock, so there is nothing to check against. */
  | 'unsecured';

export type Authenticator = {
  security(): Promise<DeviceSecurity>;
  /** Shows the system prompt. Resolves true only on a successful check. */
  authenticate(prompt: string): Promise<boolean>;
};

/** How long the app may sit in the background before it locks again. */
export const RELOCK_AFTER_MS = 60_000;

export type LockState = {
  locked: boolean;
  /** When the app last went to the background; null while in the foreground. */
  backgroundedAt: number | null;
};

/** The app always starts locked. */
export const initialLockState = (): LockState => ({ locked: true, backgroundedAt: null });

export const onBackground = (state: LockState, now: number): LockState =>
  state.backgroundedAt === null ? { ...state, backgroundedAt: now } : state;

/** Locks again only when the app was away longer than the grace period. */
export const onForeground = (state: LockState, now: number): LockState => {
  if (state.backgroundedAt === null) return state;
  const away = now - state.backgroundedAt;
  return {
    locked: state.locked || away >= RELOCK_AFTER_MS,
    backgroundedAt: null,
  };
};

/** What the phone's prompt reported. `error` is the phone's own word for why it did not pass. */
export type Check = { success: true } | { success: false; error?: string };

/** The longest the app waits on one prompt before giving up on it. */
export const PROMPT_TIMEOUT_MS = 90_000;

/**
 * The quickest a real check can be: the prompt has to appear and a finger has to
 * touch the sensor. A "success" sooner than this did not come from a person.
 */
export const FASTEST_REAL_CHECK_MS = 300;

export type CheckOptions = {
  timeoutMs?: number;
  fastestMs?: number;
  /** How long to let the phone finish closing a prompt before asking again. */
  settleMs?: number;
  now?: () => number;
};

/**
 * Runs one prompt so that it can never leave the lock screen dead.
 *
 * The phone's prompt module remembers that a prompt is open. If one was dismissed
 * without telling it (the app reloaded, or was swapped away as it appeared), the
 * module then answers every later request with "app_cancel" and shows nothing, so
 * the Unlock button seems to do nothing. That answer means "clear it and ask
 * again", not "the user said no". A prompt that never answers at all is given up
 * on after `timeoutMs` and cleared the same way.
 */
export const runCheck = async (
  attempt: () => Promise<Check>,
  reset: () => Promise<void>,
  { timeoutMs = PROMPT_TIMEOUT_MS, fastestMs = FASTEST_REAL_CHECK_MS, settleMs = 300, now = Date.now }: CheckOptions = {}
): Promise<boolean> => {
  const once = (): Promise<Check> =>
    new Promise((resolve, reject) => {
      const started = now();
      const timer = setTimeout(() => resolve({ success: false, error: 'timeout' }), timeoutMs);
      attempt().then(
        (result) => {
          clearTimeout(timer);
          // A success with no prompt in between is a leftover from an earlier check (seen
          // after the app's screens were rebuilt mid-prompt), never a person. Not accepted.
          resolve(result.success && now() - started < fastestMs ? { success: false, error: 'app_cancel' } : result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });

  const clear = () => reset().catch(() => undefined);

  let result = await once();
  if (!result.success && result.error === 'app_cancel') {
    await clear();
    // The phone will not show a new prompt while the old one is still closing.
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    result = await once();
  }
  if (!result.success && (result.error === 'timeout' || result.error === 'app_cancel')) await clear();
  return result.success;
};

export type UnlockOutcome =
  | 'unlocked'
  /** The user cancelled or failed the check; stay locked. */
  | 'denied'
  /** No screen lock on the phone; the app opens and should say so. */
  | 'unsecured';

export const unlock = async (auth: Authenticator): Promise<Result<UnlockOutcome>> => {
  try {
    if ((await auth.security()) === 'unsecured') return ok('unsecured');
    const passed = await auth.authenticate('Unlock Hisaab');
    return ok(passed ? 'unlocked' : 'denied');
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
