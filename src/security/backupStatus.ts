import { isoDate, localDate } from '@/lib/date';

/** Days without a backup before Home starts asking for one. */
export const NUDGE_AFTER_DAYS = 14;
/** How long "Later" keeps Home quiet. */
export const SNOOZE_DAYS = 7;

export type BackupStatus = {
  /** "No backup yet", "Today", "Yesterday", "9 days ago". */
  label: string;
  /** A sentence for a card or a settings line: "Last backup: 9 days ago." */
  sentence: string;
  /** Whether Home should ask for a backup now. */
  due: boolean;
};

/** Whole calendar days from `from` to `to`, both YYYY-MM-DD. */
const daysBetween = (from: string, to: string): number =>
  Math.round((localDate(to).getTime() - localDate(from).getTime()) / 86_400_000);

/**
 * When the ledger was last saved to a file, and whether it is time to say so.
 * The data lives only on this phone, so a ledger with anything in it that has
 * never been backed up, or not for a fortnight, is asked about — unless the
 * user chose "Later" and that day has not come yet.
 */
export const backupStatus = (
  lastBackup: string | undefined,
  snoozedUntil: string | undefined,
  hasData: boolean,
  today: Date = new Date()
): BackupStatus => {
  const now = isoDate(today);
  const since = lastBackup ? daysBetween(lastBackup, now) : undefined;

  const label =
    since === undefined
      ? 'No backup yet'
      : since <= 0
        ? 'Today'
        : since === 1
          ? 'Yesterday'
          : `${since} days ago`;

  const sentence = since === undefined ? 'Nothing has been backed up yet.' : `Last backup: ${label.toLowerCase()}.`;

  const stale = since === undefined || since >= NUDGE_AFTER_DAYS;
  const quiet = snoozedUntil !== undefined && now < snoozedUntil;
  return { label, sentence, due: hasData && stale && !quiet };
};
