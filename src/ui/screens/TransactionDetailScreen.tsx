import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { Paise } from '@/money/money';
import { DEFAULT_CATEGORIES } from '@/db/schema';
import { dateWithYear } from '@/lib/date';
import { t, bg, ink } from '../theme';
import { PrimaryButton, GhostButton } from '../components';
import { CategoryChip, useAmount, useInk, Icon } from '../kit';
import { Amount, BottomSheet, MoneyCard } from '../parts';

export interface TransactionDetailScreenProps {
  date: string;
  merchant: string;
  category: string;
  amount: Paise;
  account: string;
  narration: string;
  notes?: string;
  matchCount?: number;
  /** What this payment bought, when it has been broken into items. */
  itemised?: {
    lines: Array<{ id: string; name: string; quantity: string; amount: Paise }>;
    itemised: Paise;
    remaining: Paise;
  };
  onItemise?: () => void;
  onCategoryChange?: (category: string) => void;
  onApplyToAll?: (category: string) => void;
  onSave?: (notes: string) => void;
  /** Only a hand-typed entry can be deleted — a bank record never is. */
  canDelete?: boolean;
  onDelete?: () => void;
}

/** A labelled line inside the details card. */
const Detail: React.FC<{ label: string; children: React.ReactNode; first?: boolean; onPress?: () => void }> = ({
  label,
  children,
  first,
  onPress,
}) => (
  <>
    {!first && <View className={t.rule} />}
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} className="flex-row items-center justify-between py-3.5">
      <Text className={t.muted}>{label}</Text>
      {children}
    </Pressable>
  </>
);

export const TransactionDetailScreen: React.FC<
  TransactionDetailScreenProps
> = ({
  date,
  merchant,
  category,
  amount,
  account,
  narration,
  notes: initialNotes,
  matchCount,
  itemised,
  onItemise,
  onCategoryChange,
  onApplyToAll,
  onSave,
  canDelete,
  onDelete,
}) => {
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [selected, setSelected] = useState(category);
  const [picking, setPicking] = useState(false);
  const show = useAmount();
  const { colors } = useInk();
  const incoming = amount > 0;
  const moved = category === 'Transfers' || category === 'Investment';

  const choose = (name: string) => {
    setSelected(name);
    setPicking(false);
    onCategoryChange?.(name);
  };

  const confirmDelete = () => {
    Alert.alert('Delete this entry?', `${merchant}, ${show(amount)}. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  const applyToAll = () => {
    Alert.alert(
      'Apply to all?',
      matchCount === undefined
        ? `Set every ${merchant} transaction to ${selected}?`
        : `Set all ${matchCount} ${merchant} transactions to ${selected}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Apply', onPress: () => onApplyToAll?.(selected) },
      ]
    );
  };

  return (
    <ScrollView className={t.screen} contentContainerClassName="pb-12" keyboardShouldPersistTaps="handled">
      <View className={t.page}>
        <View className="items-center pb-7 pt-4">
          <CategoryChip name={selected} size={60} />
          <View className="mt-4">
            <Amount value={amount} size="hero" signed tone={moved ? 'neutral' : incoming ? 'positive' : 'negative'} fit />
          </View>
          <Text className={`mt-1.5 text-center text-[20px] font-semibold ${ink.primary}`} numberOfLines={2}>
            {merchant}
          </Text>
          <Text className={`${t.muted} mt-1`}>
            {selected} · {dateWithYear(date)}
          </Text>
        </View>

        <MoneyCard padded={false}>
          <View className="px-5">
            <Detail label="Account" first>
              <Text className={`text-[15px] font-medium ${ink.primary}`}>{account}</Text>
            </Detail>
            <Detail label="Category" onPress={() => setPicking(true)}>
              <View className="flex-row items-center">
                <Text className={`mr-1.5 text-[15px] font-medium ${ink.primary}`}>{selected}</Text>
                <Icon name="chevron" size={14} color={colors.textTertiary} />
              </View>
            </Detail>
            <Detail label="Date">
              <Text className={`text-[15px] font-medium ${ink.primary}`}>{dateWithYear(date)}</Text>
            </Detail>
          </View>
        </MoneyCard>

        <Text className={`${t.label} mb-2 ml-1`}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Add a note"
          placeholderTextColor={colors.textTertiary}
          multiline
          className={`${t.input} min-h-[88px]`}
          textAlignVertical="top"
        />

        <View className="gap-3 pt-5">
          <PrimaryButton label="Save" onPress={() => onSave?.(notes)} />
          <GhostButton label="Change category" onPress={() => setPicking(true)} />
          <GhostButton label={`Apply ${selected} to all ${merchant}`} onPress={applyToAll} />
        </View>

        {onItemise && (
          <View className="pt-8">
            <Text className={`${t.label} mb-2 ml-1`}>What it bought</Text>
            <MoneyCard gap={0}>
              {itemised && itemised.lines.length > 0 ? (
                <>
                  {itemised.lines.map((row, index) => (
                    <View key={row.id}>
                      {index > 0 && <View className={t.rule} />}
                      <View className="flex-row items-center justify-between py-3">
                        <View className="flex-1 pr-4">
                          <Text className={t.body}>{row.name}</Text>
                          <Text className={`${t.faint} mt-0.5`}>{row.quantity}</Text>
                        </View>
                        <Amount value={row.amount} size="body" />
                      </View>
                    </View>
                  ))}
                  {itemised.remaining > 0 && (
                    <Text className={`${t.faint} pt-2`}>{show(itemised.remaining)} not itemised</Text>
                  )}
                </>
              ) : (
                <Text className={`${t.muted} leading-5`}>
                  The bank only knows the total. Break it into items to see what the money actually bought.
                </Text>
              )}
              {(!itemised || itemised.remaining > 0) && (
                <View className="pt-4">
                  <GhostButton label="Itemise" onPress={onItemise} />
                </View>
              )}
            </MoneyCard>
          </View>
        )}

        <View className="pt-8">
          <Text className={`${t.label} mb-2 ml-1`}>As the bank wrote it</Text>
          <View className={`rounded-2xl ${bg.muted} px-4 py-3.5`}>
            <Text className={`${t.muted} font-mono leading-5`} selectable>{narration}</Text>
          </View>
        </View>

        {canDelete && onDelete && (
          <Pressable onPress={confirmDelete} accessibilityRole="button" className="mt-6 py-3">
            <Text className={`text-center text-[15px] font-medium ${ink.negative}`}>Delete entry</Text>
          </Pressable>
        )}
      </View>

      <BottomSheet visible={picking} onClose={() => setPicking(false)} title="Category">
        <ScrollView style={{ maxHeight: 420 }}>
          {DEFAULT_CATEGORIES.map((option, index) => (
            <View key={option.id}>
              {index > 0 && <View className={`${t.rule} ml-14`} />}
              <Pressable onPress={() => choose(option.name)} className="flex-row items-center py-3">
                <CategoryChip name={option.name} size={36} />
                <Text className={`ml-3 flex-1 text-[15px] ${option.name === selected ? 'font-semibold' : ''} ${ink.primary}`}>
                  {option.name}
                </Text>
                {option.name === selected && <Icon name="check" size={20} color={colors.accent} />}
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Pressable onPress={() => setPicking(false)} className="pt-4">
          <Text className={`${t.muted} text-center`}>Cancel</Text>
        </Pressable>
      </BottomSheet>
    </ScrollView>
  );
};
