import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch } from 'react-native';
import { tryRupeeString, toPlainRupees, type Paise } from '@/money/money';
import type { UsualPurchase } from '@/repo/usual';
import { parseDecimal } from '@/lib/decimal';
import { isoDate, monthYear } from '@/lib/date';
import type { Id } from '@/lib/ulid';
import {
  formatQuantity,
  inputUnitsFor,
  parseQuantity,
  productLabel,
  quantityInput,
  tidyBrand,
  wasPrice,
  type InputUnit,
  type LastPurchase,
  type Product,
  type Unit,
} from '@/inventory/model';
import { Field, ChipRow, ErrorText, PrimaryButton, GhostButton, Label } from '../components';
import type { NewPurchaseInput, Outcome } from '../store';
import { t } from '../theme';
import { useAmount } from '../kit';
import { ProductThumb } from '../ProductThumb';
import type { PhotoPick, PhotoSource } from '../productPhoto';
import { PhotoActions } from '../PhotoActions';

export type Itemising = {
  entryId: Id;
  merchant: string;
  date: string;
  total: Paise;
  remaining: Paise;
};

export interface AddPurchaseScreenProps {
  products: Product[];
  presetProductId?: Id;
  itemising?: Itemising;
  /** Accounts a fresh (not-itemising) purchase can be paid from, cash first. */
  accounts?: Array<{ id: string; name: string }>;
  /** What this product cost last time, how much was bought, and the price before that. */
  hintFor?: (productId: Id) => LastPurchase | null;
  /** Things typed in before that start like the text so far, most often bought first. */
  usual?: (needle: string) => UsualPurchase[];
  /** Opens the photo picker; the app keeps the copy it makes. */
  onPickPhoto?: (from: PhotoSource) => Promise<PhotoPick>;
  /** Deletes a photo that was picked but not kept. */
  onDropPhoto?: (uri: string) => void;
  onSave: (input: NewPurchaseInput) => Outcome;
  onDone: () => void;
}

const UNIT_NAMES: Record<Unit, string> = { piece: 'Pieces', g: 'Weight', ml: 'Volume' };
const UNITS: Unit[] = ['piece', 'g', 'ml'];

/** Not a real account: means "don't record money, just track the item". */
const NOT_NOW = 'later';

/** How many items the strip shows at once. */
const STRIP_LIMIT = 14;

const plainAmount = (amount: Paise): string => toPlainRupees(amount).replace(/\.00$/, '');

const same = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export const AddPurchaseScreen: React.FC<AddPurchaseScreenProps> = ({
  products,
  presetProductId,
  itemising,
  accounts = [],
  hintFor,
  usual,
  onPickPhoto,
  onDropPhoto,
  onSave,
  onDone,
}) => {
  const preset = products.find((p) => p.id === presetProductId);

  const [name, setName] = useState(preset?.name ?? '');
  const [brand, setBrand] = useState(preset?.brand ?? '');
  const [photo, setPhoto] = useState<string>();
  const [newUnit, setNewUnit] = useState<Unit>('piece');
  const [protein, setProtein] = useState('');
  const [staple, setStaple] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(itemising?.date ?? isoDate(new Date()));
  const [store, setStore] = useState(itemising?.merchant ?? '');
  const [payWith, setPayWith] = useState<string>(accounts[0]?.id ?? NOT_NOW);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string[]>([]);
  /** Once the user types a quantity or a price themselves, last time's are no longer filled in. */
  const [touched, setTouched] = useState(false);
  const show = useAmount();

  // A photo that was picked and never kept is deleted when leaving the screen.
  const unkept = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      if (unkept.current) onDropPhoto?.(unkept.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const match = useMemo(
    () => products.find((p) => same(p.name, name) && same(p.brand, tidyBrand(brand))),
    [products, name, brand]
  );
  const shown = match ?? preset;

  const unit: Unit = match?.unit ?? newUnit;
  const inputUnits = inputUnitsFor(unit);
  const [inputUnit, setInputUnit] = useState<InputUnit>(inputUnits[0]);
  const activeInputUnit = inputUnits.includes(inputUnit) ? inputUnit : inputUnits[0];

  const last = shown && hintFor ? hintFor(shown.id) : null;

  /** Puts last time's quantity, unit and price in the form. Never runs over what was typed. */
  const fillFrom = (product: Product) => {
    const before = hintFor?.(product.id);
    if (!before) return;
    const { text, inputUnit: unitText } = quantityInput(before.quantity, product.unit);
    setQuantity(text);
    setInputUnit(unitText);
    setAmount(plainAmount(before.amount));
  };

  // The item typed matches one already tracked, and nothing has been typed for it yet.
  useEffect(() => {
    if (match && !touched) fillFrom(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id]);

  useEffect(() => {
    if (preset) fillFrom(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Your items, most recently bought first, narrowed by what is typed in the name box.
  const strip = useMemo(() => {
    const needle = name.trim().toLowerCase();
    return products
      .filter((p) => !p.archivedAt && (!needle || p.name.toLowerCase().includes(needle)))
      .map((product) => ({ product, last: hintFor?.(product.id) ?? null }))
      .sort((a, b) => (b.last?.date ?? '').localeCompare(a.last?.date ?? '') || (b.last?.count ?? 0) - (a.last?.count ?? 0))
      .slice(0, STRIP_LIMIT);
  }, [products, name, hintFor]);

  const choose = (product: Product) => {
    setName(product.name);
    setBrand(product.brand ?? '');
    if (unkept.current) onDropPhoto?.(unkept.current);
    unkept.current = undefined;
    setPhoto(undefined);
    setTouched(false);
    setError(undefined);
    fillFrom(product);
  };

  // What was typed in before, for names not tracked as items yet. Offered, never filled in silently.
  const history = useMemo(
    () =>
      usual && !itemising && !match
        ? usual(name).filter((h) => !products.some((p) => same(p.name, h.name)))
        : [],
    [usual, name, itemising, match, products]
  );

  const pickHistory = (past: UsualPurchase) => {
    setName(past.name);
    if (!amount.trim()) setAmount(plainAmount(past.latest));
  };

  const isNew = !match && name.trim().length > 0;
  const label = productLabel({ name: name.trim() || 'Item', brand: tidyBrand(brand) });

  const choosePhoto = async (from: PhotoSource) => {
    setError(undefined);
    const picked = await onPickPhoto?.(from);
    if (!picked) return;
    if ('error' in picked) return setError(picked.error);
    if (unkept.current) onDropPhoto?.(unkept.current);
    unkept.current = picked.uri;
    setPhoto(picked.uri);
  };

  const save = () => {
    setError(undefined);

    if (!name.trim()) return setError('Name the item');

    const parsedQuantity = parseQuantity(quantity, activeInputUnit);
    if (parsedQuantity === null) {
      return setError(
        activeInputUnit === 'pcs' ? 'Enter a whole number of pieces' : 'Enter how much you bought'
      );
    }

    const paid = tryRupeeString(amount);
    if (paid === null || paid < 0) return setError('Enter what you paid');

    let proteinMg: number | undefined;
    if (isNew && protein.trim()) {
      const parsed = parseDecimal(protein, 3);
      if (parsed === null || parsed < 0) return setError('Protein should be a number of grams');
      proteinMg = parsed;
    }

    const failed = onSave({
      productId: match?.id,
      newProduct: isNew
        ? { name: name.trim(), brand: tidyBrand(brand), unit: newUnit, proteinMg, isStaple: staple, photo }
        : undefined,
      photo: match ? photo : undefined,
      quantity: parsedQuantity,
      amount: paid,
      purchasedAt: date.trim(),
      store: store.trim() || undefined,
      entryId: itemising?.entryId,
      accountId: !itemising && payWith !== NOT_NOW ? (payWith as Id) : undefined,
    });

    if (failed) return setError(failed);

    // The photo is kept now; the one it replaced is no longer needed.
    unkept.current = undefined;
    if (match?.photo && photo && match.photo !== photo) onDropPhoto?.(match.photo);

    if (itemising) {
      // Stay put: a grocery run is usually several lines.
      setSaved([...saved, label]);
      setName('');
      setBrand('');
      setPhoto(undefined);
      setQuantity('');
      setAmount('');
      setProtein('');
      setStaple(false);
      setTouched(false);
      return;
    }

    onDone();
  };

  const wasNote = shown && last ? wasPrice(shown.unit, last) : undefined;

  return (
    <ScrollView className={t.screen} contentContainerClassName="pb-12" keyboardShouldPersistTaps="handled">
      <View className={`${t.page} gap-6 pt-6`}>
        <View>
          <Text className={t.title}>{itemising ? 'Itemise' : 'Add a purchase'}</Text>
          {itemising ? (
            <Text className={`${t.muted} mt-2 leading-5`}>
              {itemising.merchant}, {show(itemising.total)}.{' '}
              {itemising.remaining > 0
                ? `${show(itemising.remaining)} not itemised yet.`
                : 'Fully itemised.'}
            </Text>
          ) : (
            <Text className={`${t.muted} mt-2 leading-5`}>
              Tap something you buy and it fills in from last time, or type a new one. The money is
              recorded together with the item.
            </Text>
          )}
        </View>

        {saved.length > 0 && <Text className={t.muted}>Added: {saved.join(', ')}</Text>}

        {!preset && strip.length > 0 && (
          <View>
            <Label>Your items</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
              {strip.map(({ product, last: seen }) => {
                const chosen = match?.id === product.id;
                return (
                  <Pressable
                    key={product.id}
                    onPress={() => choose(product)}
                    accessibilityLabel={productLabel(product)}
                    className={`items-center rounded-2xl border px-2 py-3 ${
                      chosen ? 'border-textPrimary dark:border-textPrimary-dark' : 'border-border dark:border-border-dark'
                    }`}
                    style={{ width: 96 }}
                  >
                    <ProductThumb name={product.name} photo={product.photo} size={52} />
                    <Text className="mt-2 text-[13px] font-medium text-textPrimary dark:text-textPrimary-dark" numberOfLines={1}>
                      {product.name}
                    </Text>
                    {product.brand ? (
                      <Text className={t.faint} numberOfLines={1}>
                        {product.brand}
                      </Text>
                    ) : null}
                    <Text className="mt-0.5 text-[12px] text-textSecondary dark:text-textSecondary-dark" numberOfLines={1}>
                      {seen ? show(seen.amount, { paise: false }) : '—'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {preset ? (
          <View className="flex-row items-center gap-3">
            <ProductThumb name={preset.name} photo={preset.photo} size={52} />
            <View className="flex-1">
              <Label>Item</Label>
              <Text className={t.heading}>{productLabel(preset)}</Text>
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <Field label="Item" value={name} onChangeText={setName} placeholder="e.g. Paneer" />
            <Field label="Brand" value={brand} onChangeText={setBrand} placeholder="Optional, e.g. Anand" />
          </View>
        )}

        {last && shown && (
          <Text className={`${t.faint} -mt-3`}>
            Last {show(last.amount)} for {formatQuantity(last.quantity, shown.unit)}
            {wasNote ? ` · was ${show(wasNote.amount)}${wasNote.per ? ` per ${wasNote.per}` : ''}` : ''} · bought{' '}
            {last.count === 1 ? 'once' : `${last.count} times`}
          </Text>
        )}

        {history.length > 0 && (
          <View className="-mt-2 gap-2">
            {history.map((past) => (
              <Pressable
                key={past.name}
                onPress={() => pickHistory(past)}
                className="flex-row items-center justify-between rounded-xl bg-surfaceMuted dark:bg-surfaceMuted-dark px-4 py-3"
              >
                <View className="flex-1 pr-3">
                  <Text className={t.body}>{past.name}</Text>
                  <Text className={t.faint}>{past.count === 1 ? 'Once before' : `${past.count} times before`}</Text>
                </View>
                <View className="items-end">
                  <Text className={t.muted}>last {show(past.latest)}</Text>
                  {past.was && (
                    <Text className={t.faint}>
                      was {show(past.was.amount)} until {monthYear(past.was.until)}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {(isNew || match || preset) && (
          <View className={`${t.card} gap-4`}>
            {isNew && <Text className={t.heading}>New item</Text>}
            {isNew && (
              <View>
                <Label>Measured in</Label>
                <ChipRow options={UNITS} value={newUnit} onChange={setNewUnit} labelFor={(u) => UNIT_NAMES[u]} />
              </View>
            )}

            <View className="flex-row items-center gap-3">
              <ProductThumb name={label} photo={photo ?? shown?.photo} size={56} />
              <View className="flex-1">
                <Text className={t.body}>Photo</Text>
                <Text className={`${t.faint} mt-0.5`}>Optional</Text>
              </View>
              {onPickPhoto && <PhotoActions hasPhoto={!!(photo ?? shown?.photo)} onPick={choosePhoto} />}
            </View>

            {isNew && (
              <>
                <Field
                  label={newUnit === 'piece' ? 'Protein per piece, g' : `Protein per 100 ${newUnit}, g`}
                  value={protein}
                  onChangeText={setProtein}
                  placeholder="Optional — from the label"
                  numeric
                />
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-4">
                    <Text className={t.body}>Regular buy</Text>
                    <Text className={`${t.faint} mt-0.5`}>Bread, milk — things you always buy</Text>
                  </View>
                  <Switch value={staple} onValueChange={setStaple} />
                </View>
              </>
            )}
          </View>
        )}

        <View className="gap-2">
          <Field
            label="How much"
            value={quantity}
            onChangeText={(text) => {
              setTouched(true);
              setQuantity(text);
            }}
            placeholder="0"
            numeric
          />
          {inputUnits.length > 1 ? (
            <ChipRow options={inputUnits} value={activeInputUnit} onChange={setInputUnit} />
          ) : (
            <Text className={t.faint}>pieces</Text>
          )}
        </View>

        {!itemising && accounts.length > 0 && (
          <View>
            <Label>Paid from</Label>
            <ChipRow
              options={[...accounts.map((a) => a.id), NOT_NOW]}
              value={payWith}
              onChange={setPayWith}
              labelFor={(id) => accounts.find((a) => a.id === id)?.name ?? 'Already counted'}
            />
          </View>
        )}

        <Field
          label="Paid"
          value={amount}
          onChangeText={(text) => {
            setTouched(true);
            setAmount(text);
          }}
          prefix="₹"
          placeholder="0.00"
          numeric
        />
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        {!itemising && <Field label="Shop" value={store} onChangeText={setStore} placeholder="Optional" />}

        <ErrorText message={error} />

        <View className="gap-3">
          <PrimaryButton label={itemising ? 'Add item' : 'Save'} onPress={save} />
          {itemising && <GhostButton label="Done" onPress={onDone} />}
        </View>
      </View>
    </ScrollView>
  );
};
