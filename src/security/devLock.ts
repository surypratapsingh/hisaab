/**
 * DEVELOPMENT ONLY — to be deleted before the app ships (see todo.md).
 *
 * While the app is being built, the lock screen is skipped so testing on the phone is
 * not interrupted by a fingerprint every time the screens reload. The switch is the
 * build itself: `__DEV__` is false in every release bundle, so a shipped APK always
 * asks for the fingerprint. There is deliberately no setting, stored value, intent or
 * link that can turn the lock off, so nothing installed on the phone can do it either.
 *
 * To test the real lock on a development build, set KEEP_LOCK_IN_DEV to true by hand.
 */
const KEEP_LOCK_IN_DEV = false;

export const LOCK_OFF_FOR_DEVELOPMENT: boolean =
  typeof __DEV__ !== 'undefined' && __DEV__ === true && !KEEP_LOCK_IN_DEV;
