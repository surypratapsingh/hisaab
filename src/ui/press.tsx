import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native';
import { noteOrigin } from './motion/origin';
import { SPRING, type HapticKind } from './motion/tokens';
import { canMove } from './motion/useMotion';
import { feel } from './motion/runtime';

/**
 * A pressable that gives a little under the finger: it shrinks a few percent
 * while held and springs back. The scale runs on the native driver, so it stays
 * smooth while the JS thread is busy. With motion set to none it does not move.
 *
 * `style` positions the whole thing (margins, flex); `className` styles the
 * pressable inside it (surface, padding). `haptic` adds a tap on the finger when
 * it is pressed, for the few actions that deserve one (never for plain navigation).
 */
export const PressableScale: React.FC<
  PressableProps & {
    style?: StyleProp<ViewStyle>;
    className?: string;
    scale?: number;
    haptic?: HapticKind;
    /** Notes where this sits as the finger goes down, so the screen it opens can grow out of it. */
    remember?: boolean;
  }
> = ({ style, className, scale = 0.97, haptic, remember, onPress, onPressIn, onPressOut, children, ...rest }) => {
  const size = useRef(new Animated.Value(1)).current;
  const box = useRef<View>(null);
  const to = (value: number) => {
    if (!canMove('fade')) return;
    Animated.spring(size, { toValue: value, useNativeDriver: true, ...SPRING.press }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: size }] }, style]}>
      <Pressable
        {...rest}
        ref={box}
        className={className}
        onPress={
          onPress
            ? (e) => {
                if (haptic) feel.haptic(haptic);
                onPress(e);
              }
            : undefined
        }
        onPressIn={(e) => {
          if (remember) box.current?.measureInWindow((x, y, width, height) => noteOrigin({ x, y, width, height }));
          if (onPress) to(scale);
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          to(1);
          onPressOut?.(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
};
