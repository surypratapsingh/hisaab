import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { t, ink } from './theme';
import { Field, ErrorText, PrimaryButton, GhostButton, SheetBody, SheetOverlay } from './components';
import { MoneyCard } from './parts';

/** What an action reports back: a line to show, or null when the user backed out. */
export type DataOutcome = { message: string; failed: boolean } | null;

export interface DataControls {
  onBackUp: (passphrase: string) => Promise<DataOutcome>;
  onRestore: (passphrase: string) => Promise<DataOutcome>;
  onDeleteAll: (confirmation: string) => string | undefined;
  minPassphrase: number;
  deletePhrase: string;
  /** "Last backup: 9 days ago." */
  backupSummary?: string;
}

type Sheet = 'backup' | 'restore' | 'delete' | null;

/**
 * Backup, restore and leaving. The backup is encrypted with a passphrase the
 * app never stores, so the sheet says plainly that a forgotten one cannot be
 * recovered.
 */
export const DataSection: React.FC<DataControls> = ({
  onBackUp,
  onRestore,
  onDeleteAll,
  minPassphrase,
  deletePhrase,
  backupSummary,
}) => {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const open = (next: Sheet) => {
    setPassphrase('');
    setAgain('');
    setPhrase('');
    setError(undefined);
    setSheet(next);
  };
  const close = () => {
    if (!busy) setSheet(null);
  };

  const finish = (outcome: DataOutcome) => {
    if (!outcome) return;
    if (outcome.failed) {
      setError(outcome.message);
      return;
    }
    setNotice(outcome.message);
    setSheet(null);
  };

  const run = async (work: () => Promise<DataOutcome>) => {
    setBusy(true);
    setError(undefined);
    try {
      finish(await work());
    } finally {
      setBusy(false);
    }
  };

  const backupReady = passphrase.length >= minPassphrase && passphrase === again;
  const backupHint =
    passphrase.length > 0 && passphrase.length < minPassphrase
      ? `At least ${minPassphrase} characters`
      : again.length > 0 && passphrase !== again
        ? 'The two passphrases differ'
        : undefined;

  return (
    <View>
      <MoneyCard>
        <Text className={t.label}>Backup</Text>
        <Text className={`mt-2 text-[17px] font-semibold ${ink.primary}`}>
          {notice ?? backupSummary ?? 'Not backed up yet'}
        </Text>
        <Text className={`${t.muted} mt-1.5 leading-5`}>
          Your data stays on this phone. Backups are encrypted with a passphrase only you know.
        </Text>
        <View className="mt-4">
          <PrimaryButton label="Back up now" onPress={() => open('backup')} />
        </View>
      </MoneyCard>

      <View className="gap-3">
        <GhostButton label="Restore from a backup" onPress={() => open('restore')} />
        <Pressable onPress={() => open('delete')} accessibilityRole="button" className="py-3">
          <Text className={`text-center text-[15px] font-medium ${ink.negative}`}>Delete all data</Text>
        </Pressable>
      </View>

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={close}>
        <SheetOverlay>
          <SheetBody className="gap-4">
            {sheet === 'backup' && (
              <>
                <Text className={t.section}>Back up</Text>
                <Text className={t.muted}>
                  The file is encrypted with this passphrase. It is not stored anywhere: if you
                  forget it, the backup cannot be opened by anyone, including you.
                </Text>
                <Field label="Passphrase" value={passphrase} onChangeText={setPassphrase} secure />
                <Field label="Same again" value={again} onChangeText={setAgain} secure />
                <ErrorText message={error ?? backupHint} />
                <PrimaryButton
                  label={busy ? 'Encrypting…' : 'Choose a folder and save'}
                  disabled={!backupReady || busy}
                  onPress={() => run(() => onBackUp(passphrase))}
                />
              </>
            )}

            {sheet === 'restore' && (
              <>
                <Text className={t.section}>Restore</Text>
                <Text className={t.muted}>
                  Restoring needs an empty ledger, so it never mixes two copies of the same
                  statements. On a phone that already has data, delete it first.
                </Text>
                <Field
                  label="Passphrase it was saved with"
                  value={passphrase}
                  onChangeText={setPassphrase}
                  secure
                />
                <ErrorText message={error} />
                <PrimaryButton
                  label={busy ? 'Decrypting…' : 'Choose the backup file'}
                  disabled={busy}
                  onPress={() => run(() => onRestore(passphrase))}
                />
              </>
            )}

            {sheet === 'delete' && (
              <>
                <Text className={t.section}>Delete all data</Text>
                <Text className={t.muted}>
                  Every account, transaction, item and setting on this phone is removed. There is
                  no undo. Back up first if you might want it back.
                </Text>
                <Field
                  label={`Type ${deletePhrase} to confirm`}
                  value={phrase}
                  onChangeText={setPhrase}
                />
                <ErrorText message={error} />
                <Pressable
                  disabled={phrase !== deletePhrase}
                  accessibilityRole="button"
                  onPress={() => {
                    const failed = onDeleteAll(phrase);
                    if (failed) {
                      setError(failed);
                      return;
                    }
                    setNotice('Everything on this phone has been deleted.');
                    setSheet(null);
                  }}
                  className={
                    phrase === deletePhrase
                      ? 'rounded-2xl bg-negative dark:bg-negative-dark py-4'
                      : 'rounded-2xl bg-surfaceMuted dark:bg-surfaceMuted-dark py-4'
                  }
                >
                  <Text
                    className={
                      phrase === deletePhrase
                        ? 'text-center text-[15px] font-semibold text-white'
                        : `text-center text-[15px] font-medium ${ink.tertiary}`
                    }
                  >
                    Delete everything
                  </Text>
                </Pressable>
              </>
            )}

            {busy ? (
              <ActivityIndicator className="py-3" />
            ) : (
              <Pressable onPress={close} className="py-3">
                <Text className={`${t.muted} text-center`}>Cancel</Text>
              </Pressable>
            )}
          </SheetBody>
        </SheetOverlay>
      </Modal>
    </View>
  );
};
