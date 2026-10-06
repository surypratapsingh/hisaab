import React, { useEffect } from 'react';
import { View, Text, AppState } from 'react-native';
import { PrimaryButton } from '../components';
import { t } from '../theme';

export const LockScreen: React.FC<{ onUnlock: () => void; note?: string }> = ({ onUnlock, note }) => {
  // Ask straight away; the button is there for when the prompt is dismissed.
  useEffect(() => {
    onUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The phone closes its prompt when the app is swapped away. Coming back to a locked
  // app asks again rather than leaving a dead screen (a prompt already open is left alone).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') onUnlock();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View className={`${t.page} flex-1 justify-center`}>
      <Text className={t.title}>Hisaab is locked</Text>
      <Text className={`${t.muted} mt-2 mb-8`}>
        Use your fingerprint, face or phone PIN to open it.
      </Text>
      <PrimaryButton label="Unlock" onPress={onUnlock} />
      {note ? <Text className={`${t.muted} mt-4`}>{note}</Text> : null}
    </View>
  );
};
