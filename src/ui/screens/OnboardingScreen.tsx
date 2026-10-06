import React, { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { t } from '../theme';
import { Field, ErrorText, PrimaryButton } from '../components';
import type { DataOutcome } from '../DataSection';

export type OnboardingStep = 'privacy' | 'restore' | 'account' | 'import' | 'done';

export interface OnboardingScreenProps {
  /** Returns the reason when the account could not be added. */
  onAddAccount?: (name: string, last4: string) => string | undefined;
  onImport?: () => void;
  onComplete?: () => void;
  /** Brings back an earlier backup instead of starting fresh. */
  onRestore?: (passphrase: string) => Promise<DataOutcome>;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  onAddAccount,
  onImport,
  onComplete,
  onRestore,
}) => {
  const [step, setStep] = useState<OnboardingStep>('privacy');
  const [passphrase, setPassphrase] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string>();
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');

  const canContinue = name.trim().length > 0 && /^\d{4}$/.test(last4);

  // Only move on once the account exists; a failure is shown by the app and
  // the form stays filled in to try again.
  const addAndContinue = () => {
    if (!canContinue) return;
    const failed = onAddAccount?.(name.trim(), last4);
    if (!failed) setStep('import');
  };

  if (step === 'privacy') {
    return (
      <View className={`${t.screen} ${t.page} justify-between pb-10 pt-24`}>
        <View>
          <Text className={t.title}>Hisaab</Text>
          <Text className={`${t.body} mt-6 leading-6`}>
            Your data stays on this phone.
          </Text>
          <Text className={`${t.muted} mt-3 leading-5`}>
            No account, no server, no sign-up. Nothing leaves the device.
          </Text>
        </View>

        <View className="gap-3">
          <Pressable onPress={() => setStep('account')} className={t.primaryButton}>
            <Text className={t.primaryLabel}>Start</Text>
          </Pressable>
          {onRestore && (
            <Pressable onPress={() => setStep('restore')} className="py-3">
              <Text className={`${t.muted} text-center`}>Restore from a backup</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  if (step === 'restore' && onRestore) {
    const restore = async () => {
      setRestoring(true);
      setRestoreError(undefined);
      try {
        const outcome = await onRestore(passphrase);
        // On success the ledger has accounts again and this screen goes away.
        if (outcome?.failed) setRestoreError(outcome.message);
      } finally {
        setRestoring(false);
      }
    };

    return (
      <View className={`${t.screen} ${t.page} justify-between pb-10 pt-24`}>
        <View className="gap-4">
          <Text className={t.title}>Restore</Text>
          <Text className={t.muted}>
            Enter the passphrase the backup was saved with, then choose the file.
          </Text>
          <Field label="Passphrase" value={passphrase} onChangeText={setPassphrase} secure />
          <ErrorText message={restoreError} />
        </View>

        <View className="gap-3">
          <PrimaryButton
            label={restoring ? 'Decrypting…' : 'Choose the backup file'}
            disabled={restoring}
            onPress={restore}
          />
          <Pressable onPress={() => setStep('privacy')} className="py-3" disabled={restoring}>
            <Text className={`${t.muted} text-center`}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (step === 'account') {
    return (
      <View className={`${t.screen} ${t.page} justify-between pb-10 pt-24`}>
        <View>
          <Text className={t.title}>Add an account</Text>
          <Text className={`${t.muted} mt-3`}>
            Just a name and the last four digits.
          </Text>

          <View className="gap-3 pt-8">
            <TextInput
              placeholder="Name, e.g. HDFC Savings"
              placeholderTextColor="#8B8B85"
              value={name}
              onChangeText={setName}
              className={t.input}
            />
            <TextInput
              placeholder="Last 4 digits"
              placeholderTextColor="#8B8B85"
              value={last4}
              onChangeText={setLast4}
              maxLength={4}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={addAndContinue}
              className={t.input}
            />
          </View>
        </View>

        <Pressable
          onPress={addAndContinue}
          disabled={!canContinue}
          className={
            canContinue ? t.primaryButton : 'rounded-2xl bg-surfaceMuted dark:bg-surfaceMuted-dark py-4'
          }
        >
          <Text
            className={
              canContinue
                ? t.primaryLabel
                : 'text-center text-[15px] font-medium text-textTertiary dark:text-textTertiary-dark'
            }
          >
            Continue
          </Text>
        </Pressable>
      </View>
    );
  }

  if (step === 'import') {
    return (
      <View className={`${t.screen} ${t.page} justify-between pb-10 pt-24`}>
        <View>
          <Text className={t.title}>Import a statement</Text>
          <Text className={`${t.muted} mt-3 leading-5`}>
            Twelve months of CSV or PDF fills in the whole picture at once,
            instead of waiting weeks for it to build up.
          </Text>
        </View>

        <View className="gap-3">
          <Pressable onPress={onImport} className={t.primaryButton}>
            <Text className={t.primaryLabel}>Choose a file</Text>
          </Pressable>
          <Pressable onPress={() => setStep('done')} className="py-3">
            <Text className={`${t.muted} text-center`}>Later</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className={`${t.screen} ${t.page} justify-between pb-10 pt-24`}>
      <View>
        <Text className={t.title}>Ready</Text>
        <Text className={`${t.muted} mt-3`}>
          Anything the ledger cannot explain shows up as Suspense, never hidden.
        </Text>
      </View>

      <Pressable onPress={onComplete} className={t.primaryButton}>
        <Text className={t.primaryLabel}>Open Hisaab</Text>
      </Pressable>
    </View>
  );
};
