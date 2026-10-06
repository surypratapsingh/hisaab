import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Alert, Modal } from 'react-native';
import { dateWithYear, isoDate } from '@/lib/date';
import { parseDecimal } from '@/lib/decimal';
import type { Id } from '@/lib/ulid';
import {
  formatQuantity,
  formatUnitPrice,
  formatProtein,
  inputUnitsFor,
  parseQuantity,
  productLabel,
  type InputUnit,
} from '@/inventory/model';
import type { ProductDetail, ActivityItem } from '@/inventory/repo';
import { Stat, ChipRow, Field, ErrorText, PrimaryButton, GhostButton, SheetBody, SheetOverlay } from '../components';
import type { Outcome } from '../store';
import { t } from '../theme';
import { useAmount } from '../kit';
import { amountsInText } from '@/lib/amountsInText';
import { ProductThumb } from '../ProductThumb';
import type { PhotoPick, PhotoSource } from '../productPhoto';
import { PhotoActions } from '../PhotoActions';

type Action = 'used' | 'wasted' | 'count';

const ACTION_TITLE: Record<Action, string> = {
  used: 'How much did you use?',
  wasted: 'How much went in the bin?',
  count: 'How much is left?',
};

export interface ProductScreenProps {
  detail: ProductDetail;
  onLogUse: (input: { quantity: number; kind: 'used' | 'wasted'; date: string }) => Outcome;
  onCount: (input: { remaining: number; date: string }) => Outcome;
  onBuyMore: () => void;
  onToggleStaple: (isStaple: boolean) => void;
  /** Rename, re-brand or re-photograph this item. Empty brand or photo clears it. */
  onEdit?: (patch: { name: string; brand: string; photo?: string }) => Outcome;
  onPickPhoto?: (from: PhotoSource) => Promise<PhotoPick>;
  /** Deletes a photo file that is no longer used. */
  onDropPhoto?: (uri: string) => void;
  onRemovePurchase: (purchaseId: Id) => void;
  onRemoveConsumption: (consumptionId: Id) => void;
}

const activityLabel = (item: ActivityItem): string => {
  switch (item.kind) {
    case 'purchase':
      return item.store ? `Bought at ${item.store}` : 'Bought';
    case 'used':
      return item.note === 'Stock count' ? 'Used (from a count)' : 'Used';
    case 'wasted':
      return 'Thrown away';
    case 'adjust':
      return 'Found more than tracked';
  }
};

export const ProductScreen: React.FC<ProductScreenProps> = ({
  detail,
  onLogUse,
  onCount,
  onBuyMore,
  onToggleStaple,
  onEdit,
  onPickPhoto,
  onDropPhoto,
  onRemovePurchase,
  onRemoveConsumption,
}) => {
  const { product, month, trend, history, activity } = detail;
  const units = inputUnitsFor(product.unit);
  const qty = (n: number) => formatQuantity(n, product.unit);

  const [action, setAction] = useState<Action | null>(null);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<InputUnit>(units[0]);
  const [error, setError] = useState<string>();
  const show = useAmount();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(product.name);
  const [editBrand, setEditBrand] = useState(product.brand ?? '');
  /** undefined: keep the photo it has; '': remove it; anything else: a newly chosen one. */
  const [editPhoto, setEditPhoto] = useState<string>();
  const [editError, setEditError] = useState<string>();

  const openEdit = () => {
    setEditName(product.name);
    setEditBrand(product.brand ?? '');
    setEditPhoto(undefined);
    setEditError(undefined);
    setEditing(true);
  };

  const closeEdit = () => {
    // A photo chosen here and not kept is deleted.
    if (editPhoto) onDropPhoto?.(editPhoto);
    setEditing(false);
  };

  const choosePhoto = async (from: PhotoSource) => {
    setEditError(undefined);
    const picked = await onPickPhoto?.(from);
    if (!picked) return;
    if ('error' in picked) return setEditError(picked.error);
    if (editPhoto) onDropPhoto?.(editPhoto);
    setEditPhoto(picked.uri);
  };

  const saveEdit = () => {
    const failed = onEdit?.({ name: editName, brand: editBrand, photo: editPhoto });
    if (failed) return setEditError(failed);
    // The photo it replaced or the one removed is no longer needed.
    if (editPhoto !== undefined && product.photo) onDropPhoto?.(product.photo);
    setEditing(false);
  };

  const shownPhoto = editPhoto === undefined ? product.photo : editPhoto || undefined;

  const open = (next: Action) => {
    setAction(next);
    setAmount('');
    setError(undefined);
  };

  const confirmRemove = (item: ActivityItem) =>
    Alert.alert('Remove this line?', `${activityLabel(item)} on ${dateWithYear(item.date)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          item.kind === 'purchase' ? onRemovePurchase(item.id) : onRemoveConsumption(item.id),
      },
    ]);

  const submit = () => {
    if (!action) return;
    const today = isoDate(new Date());

    if (action === 'count') {
      // "Nothing left" is a real answer here, so zero is allowed.
      const remaining = parseDecimal(amount, 3) === 0 ? 0 : parseQuantity(amount, unit);
      if (remaining === null) {
        setError('Enter how much is left');
        return;
      }
      const failed = onCount({ remaining, date: today });
      if (failed) return setError(failed);
    } else {
      const quantity = parseQuantity(amount, unit);
      if (quantity === null) {
        setError(unit === 'pcs' ? 'Enter a whole number of pieces' : 'Enter an amount');
        return;
      }
      const failed = onLogUse({ quantity, kind: action, date: today });
      if (failed) return setError(failed);
    }

    setAction(null);
  };

  return (
    <ScrollView className={t.screen} contentContainerClassName="pb-12">
      <View className={t.page}>
        <View className="pt-6 pb-6">
          <View className="mb-4 flex-row items-center gap-4">
            <ProductThumb name={product.name} photo={product.photo} size={72} />
            {onEdit && (
              <Pressable
                onPress={openEdit}
                className="rounded-full border border-border dark:border-border-dark px-4 py-2"
              >
                <Text className="text-[13px] font-medium text-textPrimary dark:text-textPrimary-dark">Edit item</Text>
              </Pressable>
            )}
          </View>
          <Text className={t.title}>{productLabel(product)}</Text>
          {month.unitPrice !== undefined || trend ? (
            <Text className={`${t.body} mt-2`}>
              {amountsInText(formatUnitPrice(trend?.latest ?? month.unitPrice!, product.unit), show)}
              {trend && trend.changePercent !== 0 && (
                <Text className={t.muted}>
                  {'  '}
                  {trend.changePercent > 0 ? 'up' : 'down'} {Math.abs(trend.changePercent)}% on
                  before
                </Text>
              )}
            </Text>
          ) : null}
        </View>

        <Text className={`${t.label} mb-3`}>This month</Text>
        <View className="flex-row gap-3 pb-4">
          <Stat caption="Bought" value={qty(month.bought)} />
          <Stat caption="Used" value={qty(month.used)} />
          <Stat caption="Left" value={qty(month.onHand)} />
        </View>
        <View className="flex-row gap-3 pb-8">
          <Stat caption="Spent" value={show(month.spent)} />
          <Stat caption="Wasted" value={qty(month.wasted)} />
          <View className="flex-1" />
        </View>

        {(product.proteinMg ?? 0) > 0 && (
          <View className={`${t.card} mb-8`}>
            <Text className={t.heading}>{formatProtein(month.proteinMg)} of protein</Text>
            <Text className={`${t.muted} mt-1 leading-5`}>
              {month.proteinEstimated
                ? 'Counted from what you bought, since nothing was logged as used.'
                : 'From what you logged as used this month.'}
              {month.costPerGramProtein !== undefined &&
                ` Costs ${show(month.costPerGramProtein)} per gram of protein.`}
            </Text>
          </View>
        )}

        {action ? (
          <View className={`${t.card} mb-8 gap-4`}>
            <Text className={t.heading}>{ACTION_TITLE[action]}</Text>
            <Field label="Amount" value={amount} onChangeText={setAmount} numeric placeholder="0" />
            {units.length > 1 && <ChipRow options={units} value={unit} onChange={setUnit} />}
            {action === 'count' && (
              <Text className={t.faint}>
                The app has {qty(detail.month.onHand)} on record. The difference is
                logged as used.
              </Text>
            )}
            <ErrorText message={error} />
            <PrimaryButton label="Save" onPress={submit} />
            <Pressable onPress={() => setAction(null)} className="py-1">
              <Text className={`${t.muted} text-center`}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View className="gap-3 pb-8">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <GhostButton label="Used some" onPress={() => open('used')} />
              </View>
              <View className="flex-1">
                <GhostButton label="Count left" onPress={() => open('count')} />
              </View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <GhostButton label="Threw some away" onPress={() => open('wasted')} />
              </View>
              <View className="flex-1">
                <GhostButton label="Bought more" onPress={onBuyMore} />
              </View>
            </View>
          </View>
        )}

        <View className={`${t.row} pb-6`}>
          <View className="flex-1 pr-4">
            <Text className={t.body}>Regular buy</Text>
            <Text className={`${t.faint} mt-0.5`}>Counted in your monthly regular spend</Text>
          </View>
          <Switch value={product.isStaple} onValueChange={onToggleStaple} />
        </View>

        {history.length > 0 && (
          <View className="pb-8">
            <Text className={`${t.label} mb-1`}>Price paid</Text>
            {history.slice(0, 12).map((point, index) => (
              <View key={point.purchaseId}>
                {index > 0 && <View className={t.rule} />}
                <View className={t.row}>
                  <View className="flex-1 pr-4">
                    <Text className={t.body}>{amountsInText(formatUnitPrice(point.unitPrice, product.unit), show)}</Text>
                    <Text className={`${t.faint} mt-0.5`}>
                      {dateWithYear(point.date)} · {qty(point.quantity)}
                      {point.store ? ` · ${point.store}` : ''}
                    </Text>
                  </View>
                  <Text className={t.amount}>{show(point.amount)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {activity.length > 0 && (
          <View>
            <Text className={`${t.label} mb-1`}>Activity</Text>
            {activity.slice(0, 30).map((item, index) => (
              <View key={item.id}>
                {index > 0 && <View className={t.rule} />}
                <Pressable
                  onLongPress={() => confirmRemove(item)}
                  className={t.row}
                >
                  <View className="flex-1 pr-4">
                    <Text className={t.body}>{activityLabel(item)}</Text>
                    <Text className={`${t.faint} mt-0.5`}>{dateWithYear(item.date)}</Text>
                  </View>
                  <Text className={t.muted}>{qty(Math.abs(item.quantity))}</Text>
                </Pressable>
              </View>
            ))}
            <Text className={`${t.faint} pt-3`}>Press and hold a line to remove it.</Text>
          </View>
        )}
      </View>

      <Modal visible={editing} transparent animationType="slide" onRequestClose={closeEdit}>
        <SheetOverlay>
          <SheetBody className="gap-4">
            <Text className={t.heading}>Edit item</Text>
            <Field label="Item" value={editName} onChangeText={setEditName} placeholder="e.g. Paneer" />
            <Field label="Brand" value={editBrand} onChangeText={setEditBrand} placeholder="Optional, e.g. Anand" />
            <View className="flex-row items-center gap-3">
              <ProductThumb name={editName || product.name} photo={shownPhoto} size={56} />
              <View className="flex-1">
                <Text className={t.body}>Photo</Text>
                <Text className={`${t.faint} mt-0.5`}>Optional</Text>
              </View>
              {onPickPhoto && <PhotoActions hasPhoto={!!shownPhoto} onPick={choosePhoto} />}
            </View>
            {shownPhoto ? (
              <Pressable onPress={() => setEditPhoto('')} className="-mt-2 self-start py-1">
                <Text className={t.muted}>Remove photo</Text>
              </Pressable>
            ) : null}
            <ErrorText message={editError} />
            <PrimaryButton label="Save" onPress={saveEdit} />
            <Pressable onPress={closeEdit} className="py-1">
              <Text className={`${t.muted} text-center`}>Cancel</Text>
            </Pressable>
          </SheetBody>
        </SheetOverlay>
      </Modal>
    </ScrollView>
  );
};
