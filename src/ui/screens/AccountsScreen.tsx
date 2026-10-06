import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, Switch } from 'react-native';
import { Paise, tryRupeeString } from '@/money/money';
import type { WealthView, WealthPart } from '@/wealth/repo';
import { asOfLine } from '@/wealth/labels';
import { datePeriod, isoDate, shortDate } from '@/lib/date';
import { namedFile } from '@/lib/fileName';
import type { WaitingAccount } from '@/capture/ingest';
import { t, ink } from '../theme';
import { PrimaryButton, GhostButton, ErrorText } from '../components';
import { TAB_BAR_SPACE, useAmount, useInk, type IconName } from '../kit';
import { Amount, AccountRow, BottomSheet, EmptyState, MoneyCard, ScreenHeader, SectionHeader } from '../parts';

export type AccountItem = {
  id: string;
  name: string;
  balance: Paise;
  institution?: string;
  last4?: string;
  /** False while the balance is only the movements seen, not a known figure. */
  balanceKnown?: boolean;
  /** True for a bank-style account a statement can be imported into (not investments or cash). */
  takesStatements?: boolean;
  /** Listed, but left out of every total. */
  excluded?: boolean;
};

/** One statement import, as Accounts lists it. */
export type ImportedStatement = {
  rawId: string;
  fileName: string;
  /** "Union Bank •••• 5501"; absent if the account has since been deleted. */
  account?: string;
  /** The first and last dates of its entries, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Entries it brought in or matched to what was already there. */
  entries: number;
  importedAt: string;
};

export interface AccountsScreenProps {
  accounts: AccountItem[];
  /** The same accounts grouped by what they are, each with where its figure comes from. */
  wealth: WealthView;
  /** Bank messages naming accounts that have not been added, whose money is not counted. */
  waiting?: WaitingAccount[];
  /** Adds an account, with what it holds now if the user types it. */
  onAddAccount?: (name: string, last4: string, balance?: Paise) => string | undefined;
  /** Renames an account or corrects its last four digits. */
  onEditAccount?: (id: string, name: string, last4: string, balance?: Paise) => string | undefined;
  /** Removes an account that was never used. Refused (with a message) if it has any history. */
  onDeleteAccount?: (id: string) => string | undefined;
  /** Leaves an account out of every total, or counts it again. */
  onExcludeAccount?: (id: string, excluded: boolean) => string | undefined;
  onImportStatement?: () => void;
  onRecordTransaction?: () => void;
  /** Opens the holdings behind the investments. */
  onOpenWealth?: () => void;
  /** The latest statement imports, newest first. */
  imports?: ImportedStatement[];
  /** Lists what one import brought in. */
  onImportPress?: (item: ImportedStatement) => void;
}

const GROUPS: Array<{ title: string; kinds: Array<WealthPart['kind']>; icon: IconName }> = [
  { title: 'Bank', kinds: ['bank'], icon: 'bank' },
  { title: 'Investments', kinds: ['investment'], icon: 'funds' },
  { title: 'Cash & other', kinds: ['cash', 'other'], icon: 'cash' },
];

/** Where is my money: every account, grouped by what it is, and how fresh each figure is. */
export const AccountsScreen: React.FC<AccountsScreenProps> = ({
  accounts,
  wealth,
  waiting = [],
  onAddAccount,
  onEditAccount,
  onDeleteAccount,
  onExcludeAccount,
  onImportStatement,
  onRecordTransaction,
  onOpenWealth,
  imports = [],
  onImportPress,
}) => {
  const [adding, setAdding] = useState(false);
  // The account being edited; null while adding a new one.
  const [editing, setEditing] = useState<AccountItem | null>(null);
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string>();
  const [excluded, setExcluded] = useState(false);
  const amount = useAmount();
  const { colors } = useInk();

  // Cash and Investments have no digits, so an edit may leave them blank.
  const canSubmit = name.trim().length > 0 && ((editing && !last4) || /^\d{4}$/.test(last4));

  const open = (account: AccountItem | null, digits = '') => {
    setEditing(account);
    setName(account?.name ?? '');
    setLast4(account?.last4 ?? digits);
    setBalance('');
    setError(undefined);
    setExcluded(account?.excluded ?? false);
    setAdding(true);
  };

  const submit = () => {
    if (!canSubmit) return;
    const opening = balance.trim() ? tryRupeeString(balance) : null;
    if (balance.trim() && opening === null) return setError('Enter the balance as a number, like 42,500.50');
    const failed = editing
      ? onEditAccount?.(editing.id, name.trim(), last4, opening ?? undefined)
      : onAddAccount?.(name.trim(), last4, opening ?? undefined);
    if (failed) return setError(failed);
    setAdding(false);
  };

  const confirmDelete = () => {
    if (!editing) return;
    Alert.alert('Delete this account?', editing.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const failed = onDeleteAccount?.(editing.id);
          if (failed) return setError(failed);
          setAdding(false);
        },
      },
    ]);
  };

  const byId = new Map(accounts.map((a) => [a.id as string, a]));
  const unknownCount = wealth.parts.filter((p) => p.unknown).length;

  return (
    <View className={t.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Accounts" subtitle="Where your money is" />

        <View className={t.page}>
          <MoneyCard>
            <Text className={t.label}>Total wealth</Text>
            <View className="mt-2">
              <Amount value={wealth.total} size="hero" fit />
            </View>
            {unknownCount > 0 && (
              <Text className={`${t.faint} mt-2 leading-4`}>
                {unknownCount} {unknownCount === 1 ? 'account is' : 'accounts are'} left out until you say what
                {unknownCount === 1 ? ' it holds' : ' they hold'}.
              </Text>
            )}
          </MoneyCard>

          {wealth.parts.length === 0 && (
            <EmptyState
              icon="🏦"
              title="No accounts yet"
              body="Add a bank account, then import a statement or let Hisaab read your bank's messages."
              action={onAddAccount ? { label: 'Add an account', onPress: () => open(null) } : undefined}
            />
          )}

          {GROUPS.map((group) => {
            const parts = wealth.parts.filter((p) => group.kinds.includes(p.kind));
            if (parts.length === 0) return null;
            return (
              <View key={group.title} className="pb-4">
                <SectionHeader title={group.title} />
                <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
                  {parts.map((part, index) => {
                    const account = byId.get(part.accountId as string);
                    const digits = account?.last4 ? `•••• ${account.last4}` : undefined;
                    const label = [account?.institution, digits].filter(Boolean).join(' · ');
                    return (
                      <View key={part.accountId}>
                        {index > 0 && <View className={`${t.rule} ml-14`} />}
                        <AccountRow
                          icon={group.icon}
                          title={part.name}
                          subtitle={label || undefined}
                          detail={asOfLine(part)}
                          amount={part.unknown ? undefined : part.value}
                          unknownLabel="Tap to set"
                          onPress={
                            part.kind === 'investment' && onOpenWealth
                              ? onOpenWealth
                              : account && onEditAccount
                                ? () => open(account)
                                : undefined
                          }
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}

          {waiting.length > 0 && (
            <View className="pb-4">
              <SectionHeader title="Not added yet" />
              <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
                <Text className={`${t.muted} pb-1 pt-3 leading-5`}>
                  Your bank messages mention these accounts. Until you add them, that money is not counted.
                </Text>
                {waiting.map((item, index) => (
                  <View key={item.digits}>
                    {index > 0 && <View className={t.rule} />}
                    <Pressable
                      onPress={() => onAddAccount && open(null, item.digits)}
                      accessibilityRole="button"
                      className="flex-row items-center py-3.5"
                    >
                      <View className="flex-1 pr-3">
                        <Text className={`text-[15px] font-semibold ${ink.primary}`}>•••• {item.digits}</Text>
                        <Text className={`${t.faint} mt-0.5`}>
                          {item.messages} message{item.messages === 1 ? '' : 's'}
                          {item.moneyOut > 0 ? ` · ${amount(item.moneyOut, { paise: false })} out` : ''}
                          {item.moneyIn > 0 ? ` · ${amount(item.moneyIn, { paise: false })} in` : ''}
                        </Text>
                      </View>
                      <Text className={`text-[13px] font-semibold ${ink.accent}`}>Add</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}

          {imports.length > 0 && (
            <View className="pb-4">
              <SectionHeader title="Imported statements" />
              <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
                {imports.map((item, index) => (
                  <View key={item.rawId}>
                    {index > 0 && <View className={t.rule} />}
                    <Pressable
                      onPress={onImportPress ? () => onImportPress(item) : undefined}
                      accessibilityRole="button"
                      accessibilityLabel={`See the ${item.entries} transactions from ${item.account ?? namedFile(item.fileName) ?? 'this statement'}`}
                      className="flex-row items-center py-3.5"
                    >
                      <View className="flex-1 pr-3">
                        <Text className={`text-[15px] font-semibold ${ink.primary}`} numberOfLines={1}>
                          {item.account ?? namedFile(item.fileName) ?? 'Statement'}
                        </Text>
                        <Text className={`${t.faint} mt-0.5`}>
                          {datePeriod(item.from, item.to)} · {item.entries} transaction{item.entries === 1 ? '' : 's'}
                        </Text>
                        <Text className={`${t.faint} mt-0.5`} numberOfLines={1}>
                          {[namedFile(item.fileName), `imported ${shortDate(isoDate(new Date(item.importedAt)))}`].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {onImportPress && <Text className={`text-[13px] font-semibold ${ink.accent}`}>See</Text>}
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View className="gap-3 pt-2">
            {onImportStatement && <PrimaryButton label="Import statement" onPress={onImportStatement} />}
            {onAddAccount && <GhostButton label="Add account" onPress={() => open(null)} />}
            {onRecordTransaction && <GhostButton label="Record a transaction by hand" onPress={onRecordTransaction} />}
          </View>
        </View>
      </ScrollView>

      <BottomSheet visible={adding} onClose={() => setAdding(false)} title={editing ? 'Edit account' : 'Add account'}>
        {editing && (
          <Text className={`${t.muted} -mt-2 mb-1`}>The last four digits are how bank messages find this account.</Text>
        )}
        <View className="gap-3 pt-2">
          <TextInput
            placeholder="Name, e.g. HDFC Savings"
            placeholderTextColor={colors.textTertiary}
            value={name}
            onChangeText={setName}
            className={t.input}
          />
          <TextInput
            placeholder="Last 4 digits"
            placeholderTextColor={colors.textTertiary}
            value={last4}
            onChangeText={setLast4}
            maxLength={4}
            keyboardType="number-pad"
            className={t.input}
          />
          <TextInput
            placeholder={editing ? 'Balance now, if you know it' : 'Balance now, e.g. 42,500 (optional)'}
            placeholderTextColor={colors.textTertiary}
            value={balance}
            onChangeText={setBalance}
            keyboardType="decimal-pad"
            className={t.input}
          />
        </View>

        {editing && onExcludeAccount && (
          <View className="flex-row items-center pt-4">
            <View className="flex-1 pr-4">
              <Text className={t.body}>Leave out of totals</Text>
              <Text className={`${t.faint} mt-0.5 leading-4`}>
                Its money is not counted in your wealth, Safe to spend, spending, income or reports. Its transactions still show in Activity.
              </Text>
            </View>
            <Switch
              value={excluded}
              accessibilityLabel={`Leave ${editing.name} out of totals`}
              onValueChange={(on) => {
                const failed = onExcludeAccount(editing.id, on);
                if (failed) return setError(failed);
                setExcluded(on);
              }}
            />
          </View>
        )}

        <View className="pt-3">
          <ErrorText message={error} />
        </View>
        <View className="gap-3 pt-4">
          <PrimaryButton label={editing ? 'Save' : 'Add'} onPress={submit} disabled={!canSubmit} />
          {editing && onDeleteAccount && (
            <Pressable onPress={confirmDelete} className="py-3">
              <Text className={`text-center text-[15px] font-medium ${ink.negative}`}>Delete account</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setAdding(false)} className="py-2">
            <Text className={`${t.muted} text-center`}>Cancel</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
};

