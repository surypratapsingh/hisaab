import React, { useState } from 'react';
import { Text, Pressable, Modal } from 'react-native';
import { t } from './theme';
import { Field, ErrorText, PrimaryButton, SheetBody, SheetOverlay } from './components';

/**
 * Banks lock statement PDFs, usually with some mix of name and birth date or
 * customer ID. The password opens the file on the phone and is not kept.
 */
export const PdfPasswordSheet: React.FC<{
  fileName?: string;
  error?: string;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}> = ({ fileName, error, busy, onSubmit, onCancel }) => {
  const [password, setPassword] = useState('');

  return (
    <Modal visible={fileName !== undefined} transparent animationType="slide" onRequestClose={onCancel}>
      <SheetOverlay>
        <SheetBody className="gap-4">
          <Text className={t.heading}>Password for this statement</Text>
          <Text className={t.muted}>
            {fileName} is locked. Your bank's email usually says what the password is made of.
            It is used to open the file here and is not saved.
          </Text>
          <Field label="PDF password" value={password} onChangeText={setPassword} secure />
          <ErrorText message={error} />
          <PrimaryButton
            label={busy ? 'Reading…' : 'Open and import'}
            disabled={busy || password.length === 0}
            onPress={() => onSubmit(password)}
          />
          <Pressable onPress={onCancel} className="py-3" disabled={busy}>
            <Text className={`${t.muted} text-center`}>Cancel</Text>
          </Pressable>
        </SheetBody>
      </SheetOverlay>
    </Modal>
  );
};
