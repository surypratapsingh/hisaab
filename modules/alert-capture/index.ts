import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid } from 'react-native';
import type { CapturedAlert } from '../../src/capture/alerts';

type AlertCaptureNative = {
  isEnabled(): boolean;
  openSettings(): void;
  drain(): string[];
};

/** Absent in Expo Go and on the web; present in the Android development build. */
const native = requireOptionalNativeModule<AlertCaptureNative>('AlertCapture');

export const captureAvailable = native !== null;

/** Whether the user has given Hisaab notification access. */
export const captureEnabled = (): boolean => native?.isEnabled() ?? false;

/** Opens Settings > Notification access, where the user switches Hisaab on. */
export const openCaptureSettings = (): void => native?.openSettings();

/** Alerts caught since the last drain, oldest first. Malformed lines are skipped. */
export const drainCaptured = (): CapturedAlert[] =>
  (native?.drain() ?? []).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as CapturedAlert & { title: string | null };
      return [{ ...parsed, title: parsed.title ?? undefined }];
    } catch {
      return [];
    }
  });

/**
 * SMS inbox messages about money received after `sinceMs`, oldest first.
 * Asks for READ_SMS first; resolves to null if the user says no.
 */
export const readSmsInbox = async (sinceMs: number): Promise<CapturedAlert[] | null> => {
  const reader = native as (AlertCaptureNative & { readInbox(since: number): Promise<string[]> }) | null;
  if (!reader) return null;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: 'Read your bank messages',
    message:
      'Hisaab reads SMS from your bank and UPI apps on this phone to record past payments. Messages never leave the phone.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) return null;
  const lines = await reader.readInbox(sinceMs);
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as CapturedAlert];
    } catch {
      return [];
    }
  });
};
