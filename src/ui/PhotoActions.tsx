import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { PhotoSource } from './productPhoto';

const PILL = 'rounded-full border border-border dark:border-border-dark px-4 py-2';
const LABEL = 'text-[13px] font-medium text-textPrimary dark:text-textPrimary-dark';

/** Take a photo with the camera, or choose one already on the phone. */
export const PhotoActions: React.FC<{ hasPhoto: boolean; onPick: (from: PhotoSource) => void }> = ({
  hasPhoto,
  onPick,
}) => (
  <View className="flex-row items-center gap-2">
    <Pressable onPress={() => onPick('camera')} className={PILL}>
      <Text className={LABEL}>{hasPhoto ? 'Retake' : 'Take photo'}</Text>
    </Pressable>
    <Pressable onPress={() => onPick('files')} className={PILL}>
      <Text className={LABEL}>Choose</Text>
    </Pressable>
  </View>
);
