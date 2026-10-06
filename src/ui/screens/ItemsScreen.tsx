import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import type { Id } from '@/lib/ulid';
import { amountsInText } from '@/lib/amountsInText';
import {
  formatQuantity,
  formatProtein,
  productLabel,
  type ProductMonth,
} from '@/inventory/model';
import type { InventoryMonth } from '@/inventory/repo';
import { monthYear } from '@/lib/date';
import type { PriceStory } from '@/repo/priceStories';
import { PrimaryButton, GhostButton } from '../components';
import { t, ink } from '../theme';
import { TAB_BAR_SPACE, useAmount } from '../kit';
import { ProductThumb } from '../ProductThumb';
import { Amount, EmptyState, MoneyCard, ScreenHeader, SectionHeader } from '../parts';

export interface ItemsScreenProps {
  month: string;
  inventory: InventoryMonth;
  /** What the user buys again and again whose price has moved. */
  prices?: PriceStory[];
  /** Opens Activity searched for that name. */
  onPricePress?: (name: string) => void;
  onProductPress: (productId: Id) => void;
  onAddPurchase: () => void;
  /** Read a bill photo or PDF invoice into items. */
  onReadBill?: () => void;
}

/** "bought 600 g · used 150 g · 450 g left" — whichever parts apply. */
const movement = (row: ProductMonth): string => {
  const qty = (n: number) => formatQuantity(n, row.product.unit);
  const parts: string[] = [];
  if (row.bought > 0) parts.push(`bought ${qty(row.bought)}`);
  if (row.used > 0) parts.push(`used ${qty(row.used)}`);
  if (row.wasted > 0) parts.push(`${qty(row.wasted)} wasted`);
  parts.push(row.onHand > 0 ? `${qty(row.onHand)} left` : 'none left');
  return parts.join(' · ');
};

/** "₹150 → ₹170 → ₹180": what it cost, in order. */
const PriceStories: React.FC<{ stories: PriceStory[]; onPress?: (name: string) => void }> = ({ stories, onPress }) => {
  const amount = useAmount();
  if (stories.length === 0) return null;

  return (
    <View className="pb-4">
      <SectionHeader title="Prices you pay" />
      <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
        {stories.map((story, index) => {
          const now = story.prices[story.prices.length - 1];
          const before = story.prices.length > 1 ? story.prices[story.prices.length - 2] : undefined;
          const up = story.changePercent > 0;
          return (
            <View key={story.name}>
              {index > 0 && <View className={t.rule} />}
              <Pressable onPress={() => onPress?.(story.name)} accessibilityRole="button" className="flex-row items-center py-3.5">
                <View className="flex-1 pr-4">
                  <Text className={`text-[15px] font-semibold ${ink.primary}`}>{story.name}</Text>
                  <Text className={`mt-0.5 text-[12px] font-medium ${up ? ink.negative : ink.positive}`}>
                    {up ? '↑' : '↓'} {Math.abs(story.changePercent)}%
                    <Text className={`font-normal ${ink.tertiary}`}> since {monthYear(story.prices[0].from)}</Text>
                  </Text>
                  <Text className={`${t.faint} mt-0.5`}>{story.prices.map((p) => amount(p.amount)).join(' → ')}</Text>
                </View>
                <View className="items-end">
                  <Amount value={now.amount} size="body" />
                  {before && <Text className={`${t.faint} mt-0.5`}>was {amount(before.amount)}</Text>}
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
      <Text className={`${t.faint} pt-2`}>Worked out from what you typed in. Only shown where the amounts look like a price.</Text>
    </View>
  );
};

export const ItemsScreen: React.FC<ItemsScreenProps> = ({
  month,
  inventory,
  prices = [],
  onPricePress,
  onProductPress,
  onAddPurchase,
  onReadBill,
}) => {
  const { rows, totals, insights } = inventory;
  const amount = useAmount();

  if (rows.length === 0) {
    return (
      <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
        <ScreenHeader title="Your items" subtitle="What each purchase actually bought." />
        <EmptyState
          icon="🛒"
          title="No items tracked yet"
          body="The bank says where your money went. Items say what it bought: how much bread or paneer, what each cost, and how much you used. To split a grocery payment into items, open it from Activity and tap Itemise."
        />
        <View className={`${t.page} gap-3`}>
          <PrimaryButton label="Add a purchase" onPress={onAddPurchase} />
          {onReadBill && <GhostButton label="Read a bill" onPress={onReadBill} />}
        </View>
      </ScrollView>
    );
  }

  const productName = new Map(rows.map((r) => [r.product.id, productLabel(r.product)]));

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
      <ScreenHeader title="Your items" />
      <View className={t.page}>
        <MoneyCard>
          <Text className={t.label}>{month}</Text>
          <View className="mt-2">
            <Amount value={totals.spent} size="hero" fit />
          </View>
          <Text className={`${t.muted} mt-1`}>
            on {totals.itemsBought} {totals.itemsBought === 1 ? 'item' : 'items'} you track
          </Text>
          <View className="mt-4 flex-row gap-6">
            <View>
              <Text className={t.faint}>Regular buys</Text>
              <View className="mt-1">
                <Amount value={totals.staples} size="body" />
              </View>
            </View>
            {totals.proteinMg > 0 && (
              <View>
                <Text className={t.faint}>Protein</Text>
                <Text className={`mt-1 text-[16px] font-semibold ${ink.primary}`}>{formatProtein(totals.proteinMg)}</Text>
                {totals.costPerGramProtein !== undefined && (
                  <Text className={`${t.faint} mt-0.5`}>{amount(totals.costPerGramProtein)} per g</Text>
                )}
              </View>
            )}
          </View>
        </MoneyCard>

        {insights.length > 0 && (
          <MoneyCard>
            <Text className={t.label}>Worth a look</Text>
            {insights.map((insight, index) => (
              <View key={`${insight.productId}-${insight.kind}`}>
                {index > 0 && <View className={`${t.rule} my-3`} />}
                <Pressable onPress={() => onProductPress(insight.productId)} accessibilityRole="button" className={index === 0 ? 'pt-3' : undefined}>
                  <Text className={`${t.faint} mb-1`}>{productName.get(insight.productId)}</Text>
                  <Text className={`${t.body} leading-5`}>{amountsInText(insight.sentence, amount)}</Text>
                </Pressable>
              </View>
            ))}
          </MoneyCard>
        )}

        <PriceStories stories={prices} onPress={onPricePress} />

        <SectionHeader title="This month" />
        <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
          {rows.map((row, index) => (
            <View key={row.product.id}>
              {index > 0 && <View className={`${t.rule} ml-14`} />}
              <Pressable onPress={() => onProductPress(row.product.id)} accessibilityRole="button" className="flex-row items-center py-3.5">
                <ProductThumb name={row.product.name} photo={row.product.photo} size={40} />
                <View className="ml-3 flex-1 pr-4">
                  <View className="flex-row items-center gap-2">
                    <Text className={`text-[15px] font-semibold ${ink.primary}`}>{productLabel(row.product)}</Text>
                    {row.product.isStaple && <View className="h-1.5 w-1.5 rounded-full bg-textTertiary dark:bg-textTertiary-dark" />}
                  </View>
                  <Text className={`${t.faint} mt-0.5`}>{movement(row)}</Text>
                </View>
                {row.spent > 0 ? <Amount value={row.spent} size="body" /> : <Text className={ink.tertiary}>—</Text>}
              </Pressable>
            </View>
          ))}
        </View>

        <Text className={`${t.faint} pt-3`}>• marks a regular buy</Text>

        <View className="gap-3 pt-6">
          <PrimaryButton label="Add a purchase" onPress={onAddPurchase} />
          {onReadBill && <GhostButton label="Read a bill" onPress={onReadBill} />}
        </View>
      </View>
    </ScrollView>
  );
};
