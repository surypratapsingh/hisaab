import React from 'react';
import { Text, Pressable, Modal } from 'react-native';
import { t } from './theme';
import { SheetBody, SheetOverlay } from './components';
import type { AccountItem } from './screens/AccountsScreen';

/**
 * A CSV statement does not say whose it is, and a wrong guess puts a whole month of someone
 * else's money into the wrong account. With several accounts the user picks.
 */
export const ChooseAccountSheet: React.FC<{
  fileName?: string;
  accounts: AccountItem[];
  onChoose: (account: AccountItem) => void;
  onCancel: () => void;
}> = ({ fileName, accounts, onChoose, onCancel }) => (
  <Modal visible={fileName !== undefined} transparent animationType="slide" onRequestClose={onCancel}>
    <SheetOverlay>
      <SheetBody className="gap-3">
        <Text className={t.heading}>Which account is this statement for?</Text>
        <Text className={t.muted}>
          {fileName} does not say. Pick the account it came from; its transactions go there.
        </Text>
        {accounts.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => onChoose(a)}
            accessibilityRole="button"
            accessibilityLabel={`Import into ${a.name}${a.last4 ? ` ending ${a.last4}` : ''}`}
            className="rounded-2xl border border-border dark:border-border-dark px-4 py-4"
          >
            <Text className={t.body}>{a.name}</Text>
            {a.last4 ? <Text className={t.muted}>ending {a.last4}</Text> : null}
          </Pressable>
        ))}
        <Pressable onPress={onCancel} className="py-3">
          <Text className={`${t.muted} text-center`}>Cancel</Text>
        </Pressable>
      </SheetBody>
    </SheetOverlay>
  </Modal>
);
