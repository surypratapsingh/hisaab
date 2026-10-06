import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';

/**
 * A product's photo, or its first letter when there is none (or the file is gone, as
 * after restoring a backup onto a new phone, where photos do not travel).
 */
export const ProductThumb: React.FC<{ name: string; photo?: string; size?: number }> = ({
  name,
  photo,
  size = 44,
}) => {
  const [broken, setBroken] = useState(false);
  const radius = Math.round(size * 0.26);

  // Only files the app itself keeps are ever shown, never an address or another app's file.
  if (photo && photo.startsWith('file://') && !broken) {
    return (
      <Image
        source={{ uri: photo }}
        onError={() => setBroken(true)}
        accessibilityLabel={`Photo of ${name}`}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }

  return (
    <View
      className="items-center justify-center bg-surfaceMuted dark:bg-surfaceMuted-dark"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Text className="font-semibold text-textSecondary dark:text-textSecondary-dark" style={{ fontSize: Math.round(size * 0.42) }}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
};
