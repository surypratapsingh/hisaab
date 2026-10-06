import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StatusBar,
  ActivityIndicator,
  Alert,
  type AlertButton,
  AppState,
  Appearance,
  BackHandler,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView as NativeSafeArea } from 'react-native-safe-area-context';
import { cssInterop, colorScheme } from 'nativewind';
import { LockScreen } from './screens/LockScreen';
import {
  initialLockState,
  onBackground,
  onForeground,
  unlock,
  type LockState,
} from '@/security';
import { deviceAuthenticator } from '@/security/deviceAuth';
import { HomeScreen } from './screens/HomeScreen';
import { TimelineScreen } from './screens/TimelineScreen';
import { TransactionDetailScreen } from './screens/TransactionDetailScreen';
import { ReviewQueueScreen } from './screens/ReviewQueueScreen';
import { AccountsScreen } from './screens/AccountsScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { ItemsScreen } from './screens/ItemsScreen';
import { ProductScreen } from './screens/ProductScreen';
import { AddPurchaseScreen } from './screens/AddPurchaseScreen';
import { AddTransactionScreen } from './screens/AddTransactionScreen';
import { ScanPayScreen } from './screens/ScanPayScreen';
import { SafeToSpendScreen } from './screens/SafeToSpendScreen';
import { SubscriptionsScreen } from './screens/SubscriptionsScreen';
import { InsightsScreen } from './screens/InsightsScreen';
import { WealthScreen } from './screens/WealthScreen';
import { WealthHero } from './WealthHero';
import { Icon, useInk, useAmount } from './kit';
import { AppTabBar, AddSheet, LoadingSkeleton, type AddKind } from './parts';
import { MotionHost } from './motion/MotionHost';
import { setScreen } from './motion/moments';
import { chargeOf, weatherOf } from './motion/battery';
import { MoneyWeather } from './motion/MoneyWeather';
import { RouteTransition } from './motion/RouteTransition';
import { clearOrigin, takeOrigin } from './motion/origin';
import { MoreScreen, type MoreTarget } from './screens/MoreScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { RecurringScreen } from './screens/RecurringScreen';
import { BudgetsScreen } from './screens/BudgetsScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { reportView, categoryFlow, largestSpends, spendingCategoryNames, type ReportSide } from '@/repo/reports';
import { cashFlow, goalProgress, monthSummary, type Money, type ReportKind } from '@/reports/doc';
import { reportHtml } from '@/reports/html';
import { rupees } from '@/lib/rupees';
import { ReportDocScreen } from './screens/ReportDocScreen';
import { entriesCsv, importedEntries, searchEntries } from '@/repo/search';
import { statementImports } from '@/repo/import';
import type { ImportResult } from '@/import/types';
import { backupStatus } from '@/security/backupStatus';
import { LOCK_OFF_FOR_DEVELOPMENT } from '@/security/devLock';
import { usualPurchases } from '@/repo/usual';
import { pickProductPhoto, discardProductPhoto, discardAllProductPhotos } from './productPhoto';
import { MessagesScreen } from './screens/MessagesScreen';
import { messagesView } from '@/capture/messages';
import { BillScreen } from './screens/BillScreen';
import { parseBill, rowsFromBoxes, type Bill } from '@/bills/bill';
import { billMatches } from '@/bills/repo';
import { isCas } from '@/wealth/repo';
import { isPaisaBackup } from '@/repo/paisa';
import { readLayout, layoutText, PdfLayoutParser } from '@/import/pdf/layout';
import { File } from 'expo-file-system';
import {
  takeShared,
  takeShortcut,
  onShortcut,
  type Shortcut,
  onShare,
  readSharedText,
  recognizeText,
  scanCode,
  openUpi,
  type SharedFile,
} from '../../modules/intake';
import { upiLink, upiAnswer, type UpiRequest } from '@/upi/link';
import { suggestedCategory } from '@/upi/session';
import { useLedger, database, storedTheme, type Outcome, type ThemeChoice } from './store';
import type { Database } from '@/db/client';
import { pickStatement } from './pickStatement';
import { PdfPasswordSheet } from './PdfPasswordSheet';
import { ChooseAccountSheet } from './ChooseAccountSheet';
import { needsAccountChoice, statementTargets } from './statementTargets';
import { readPdfLayout } from '../../modules/pdf-text';
import {
  captureAvailable,
  captureEnabled,
  openCaptureSettings,
  drainCaptured,
  readSmsInbox,
} from '../../modules/alert-capture';
import type { ManualKind } from '@/repo/manual';
import { secureRandom, saveBackupFile, saveTextFile, pickBackupFile } from './backupFiles';
import type { DataControls, DataOutcome } from './DataSection';
import { MIN_PASSPHRASE_LENGTH } from '@/security/encryption';
import { DELETE_CONFIRMATION } from '@/security/backup';
import { entryDetail } from '@/repo/views';
import { openLedgerFile } from '@/db/drivers/opAtRest';
import { DEFAULT_CATEGORIES } from '@/db/schema';
import { isNegative, type Paise } from '@/money/money';
import { shortDate, isoDate, addDays, datePeriod, dateWithYear } from '@/lib/date';
import { readBillText, type BillDraft } from '@/bills/billText';
import { PrimaryButton } from './components';
import { namedFile, shownFileName } from '@/lib/fileName';
import type { Id } from '@/lib/ulid';
import {
  productDetail,
  itemisationOf,
  listProducts,
  lastPurchaseOf,
} from '@/inventory/repo';
import { formatQuantity } from '@/inventory/model';
import { t } from './theme';

type Tab = 'Home' | 'Activity' | 'Reports' | 'More';

type Route =
  // `query` opens Activity already searching, e.g. from a category's row.
  | { screen: Tab; query?: string }
  | { screen: 'Review' }
  | { screen: 'Detail'; entryId: Id }
  | { screen: 'Product'; productId: Id }
  | { screen: 'AddPurchase'; productId?: Id; entryId?: Id }
  | { screen: 'AddTransaction'; preset?: { kind: ManualKind; accountId?: string; title?: string } }
  | { screen: 'ScanPay' }
  | { screen: 'SafeToSpend' }
  | { screen: 'Subscriptions' }
  | { screen: 'Insights' }
  // What one statement import brought in, listed like Activity.
  | { screen: 'Imported'; rawId: string; title: string }
  | { screen: 'ReportDoc'; kind: ReportKind; month?: string }
  | { screen: 'Messages' }
  | { screen: 'Wealth' }
  | { screen: 'Bill'; bill: Bill; text: string; sourceRef: string }
  | { screen: 'Goals' }
  | { screen: 'Recurring'; draft?: BillDraft }
  | { screen: 'Budgets' }
  | { screen: 'Items' }
  | { screen: 'Accounts' }
  | { screen: 'Settings' };

// Android draws edge to edge, so content must be padded clear of the status
// and navigation bars; react-native's own SafeAreaView only does that on iOS.
const SafeAreaView = cssInterop(NativeSafeArea, { className: 'style' });

const TABS: Tab[] = ['Home', 'Activity', 'Reports', 'More'];

/** Categories that make sense for a hand-typed expense. */
const EXPENSE_CATEGORIES = DEFAULT_CATEGORIES.filter(
  (c) => !['cat_salary', 'cat_transfers', 'cat_investment', 'cat_unknown'].includes(c.id)
);

/** The accounts a UPI payment can come out of: bank and wallet accounts, not Cash or Investments. */
const upiAccounts = (db: Database) =>
  (db.getAllAccounts().getOrNull() ?? [])
    .filter((a) => !a.isSystem && a.kind === 'asset' && a.subkind !== 'cash' && a.subkind !== 'investment')
    .map((a) => ({ id: a.id as string, name: a.name }));

const monthLabel = (): string =>
  new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/**
 * Resolves once Hisaab is in front again. A system picker can hand back its answer before
 * the app has come back, and an alert raised in that moment is dropped without a trace.
 */
const whenActive = (): Promise<void> =>
  new Promise((resolve) => {
    if (AppState.currentState === 'active') return resolve();
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      sub.remove();
      resolve();
    });
  });

/**
 * Puts on the look saved under Appearance while "Opening your data" is up. The phone answers
 * a change of look a moment later; answered after Home is drawn, it draws every screen again.
 * Waits for that answer, or 150 ms when the look was already on and none comes.
 */
const putOnTheme = (theme: ThemeChoice): Promise<void> =>
  new Promise((resolve) => {
    if (theme === 'system') return resolve();
    const done = () => {
      sub.remove();
      clearTimeout(timer);
      resolve();
    };
    const sub = Appearance.addChangeListener(done);
    const timer = setTimeout(done, 150);
    colorScheme.set(theme);
  });

export const App: React.FC = () => (
  <SafeAreaProvider>
    <AppBody />
    <MotionHost />
  </SafeAreaProvider>
);

const AppBody: React.FC = () => {
  const ledger = useLedger();
  const { ink, dark, colors } = useInk();
  const [adding, setAdding] = useState(false);
  const showAmount = useAmount();

  // Whatever the user picked under Accounts › Appearance, applied to every screen at once.
  useEffect(() => {
    colorScheme.set(ledger.theme);
  }, [ledger.theme]);
  const [stack, setStack] = useState<Route[]>([{ screen: 'Home' }]);
  const [reportMonth, setReportMonth] = useState<string>();
  const [reportSide, setReportSide] = useState<ReportSide>('expense');

  const route = stack[stack.length - 1];

  // A screen opened by pressing something grows out of it; one reached any other way just arrives.
  const routeKey = `${stack.length}|${route.screen}|${'entryId' in route ? route.entryId : ''}|${'productId' in route ? (route.productId ?? '') : ''}`;
  const lastLength = useRef(stack.length);
  const origin = useMemo(() => {
    const pushed = stack.length > lastLength.current;
    lastLength.current = stack.length;
    return pushed ? takeOrigin() : (clearOrigin(), null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  // From the current stack, not this render's: the share listener calls these from an old render.
  const go = (next: Route) => setStack((s) => [...s, next]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // The phone's own Back: step back through the screens, then to Home, and only leave from there.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        setStack(stack.slice(0, -1));
        return true;
      }
      if (stack[0].screen !== 'Home') {
        setStack([{ screen: 'Home' }]);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack]);
  const switchTab = (tab: Tab) => setStack([{ screen: tab }]);
  const openActivity = (query: string) => setStack([{ screen: 'Activity', query }]);
  const openImported = (rawId: string, title: string) => go({ screen: 'Imported', rawId, title });

  // The relock clock is kept outside React state, so only locking or unlocking redraws the app.
  // Held in state, every trip to the background and back redrew every screen twice.
  const lockClock = useRef<LockState>(initialLockState());
  const [locked, setLocked] = useState(lockClock.current.locked);
  const moveLock = (next: LockState) => {
    lockClock.current = next;
    setLocked(next.locked);
  };

  // The motion layer waits for the screen an event belongs on (money arriving waits for Home).
  useEffect(() => {
    setScreen(locked && !LOCK_OFF_FOR_DEVELOPMENT ? 'Locked' : !ledger.ready ? 'Loading' : route.screen);
  }, [locked, ledger.ready, route.screen]);
  const unlocking = useRef(false);
  const warnedUnsecured = useRef(false);
  /** Why the lock screen is still up, after a check that did not pass. */
  const [lockNote, setLockNote] = useState<string>();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      // The system prompt itself sends the app to 'inactive'/'background';
      // that must not start the relock clock.
      if (unlocking.current) return;
      if (next === 'background') moveLock(onBackground(lockClock.current, Date.now()));
      if (next === 'active') moveLock(onForeground(lockClock.current, Date.now()));
    });
    return () => sub.remove();
  }, []);

  const tryUnlock = async () => {
    if (unlocking.current) return;
    unlocking.current = true;
    setLockNote(undefined);
    const outcome = await unlock(deviceAuthenticator);
    unlocking.current = false;

    if (outcome.isErr()) {
      setLockNote("Could not reach the phone's fingerprint or PIN check. Tap Unlock to try again.");
      Alert.alert('Could not check your identity', outcome.error.message);
      return;
    }
    if (outcome.value === 'denied') {
      setLockNote('Not unlocked. Tap Unlock to try again.');
      return;
    }
    if (outcome.value === 'unsecured' && !warnedUnsecured.current) {
      warnedUnsecured.current = true;
      Alert.alert(
        'No screen lock on this phone',
        'Hisaab can only be locked when your phone has a PIN, pattern, password or fingerprint set up.'
      );
    }
    moveLock({ locked: false, backgroundedAt: null });
  };

  // The database is opened once for the life of the app, encrypted at rest (src/db/atRest.ts).
  const [opening, setOpening] = useState<{ moving?: boolean; error?: string }>({});
  const openData = () => {
    setOpening({});
    openLedgerFile(() => setOpening({ moving: true }))
      .then(async ({ driver, problem }) => {
        await putOnTheme(storedTheme(driver));
        ledger.open(driver);
        setOpening({});
        if (problem) Alert.alert('Your data is not encrypted yet', problem);
      })
      .catch((e: unknown) => setOpening({ error: e instanceof Error ? e.message : String(e) }));
  };
  useEffect(() => {
    openData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ledger.error) {
      Alert.alert('Something went wrong', ledger.error, [
        { text: 'OK', onPress: ledger.clearError },
      ]);
    }
  }, [ledger.error, ledger.clearError]);

  const [lockedPdf, setLockedPdf] = useState<{ uri: string; fileName: string; error?: string }>();
  /** A CSV waiting for the user to say which account it belongs to. */
  const [csvToPlace, setCsvToPlace] = useState<{ text: string; fileName: string }>();
  const [readingPdf, setReadingPdf] = useState(false);

  // A file shared from another app: the one that opened Hisaab, and any
  // shared while it is already open.
  useEffect(() => {
    if (!ledger.ready) return;
    const first = takeShared();
    if (first) void handleFile(first, { shared: true });
    return onShare((file) => {
      takeShared();
      void handleFile(file, { shared: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger.ready]);


  // A launcher shortcut (press and hold the icon): land on that form, with Home behind it.
  // While locked this only sets the screen; the lock screen stays in front until unlocked.
  useEffect(() => {
    if (!ledger.ready) return;
    const open = (name: Shortcut | null) => {
      if (name === 'scan') setStack([{ screen: 'Home' }, { screen: 'ScanPay' }]);
      if (name === 'purchase') setStack([{ screen: 'Home' }, { screen: 'AddPurchase' }]);
      if (name === 'transaction') setStack([{ screen: 'Home' }, { screen: 'AddTransaction' }]);
    };
    open(takeShortcut());
    return onShortcut((name) => {
      takeShortcut();
      open(name);
    });
  }, [ledger.ready]);

  // SMS: once the user has let the app read their history, each return to
  // the app also reads anything new, in case a notification was missed.
  const SMS_READ_UNTIL = 'sms_read_until';
  const [readingSms, setReadingSms] = useState(false);
  const smsReadUntil = (): number | null => {
    const saved = useLedger.getState().ready ? database().getSetting(SMS_READ_UNTIL).getOrNull() : null;
    return saved === null || saved === undefined ? null : Number(saved);
  };
  const readSms = async (since: number, announce: boolean) => {
    // Only the Settings button shows that it is reading: the state redraws every screen,
    // twice, and a return to the app reads SMS every time.
    if (announce) setReadingSms(true);
    // On a return to the app (not the Settings button), the alerts waiting in the listener's
    // queue go in together with the new SMS: each batch re-reads and redraws every screen.
    const queued = () => (announce ? [] : drainCaptured());
    try {
      const messages = await readSmsInbox(since);
      if (!messages) {
        useLedger.getState().ingestCaptured(queued());
        if (announce) {
          Alert.alert('SMS not read', 'Hisaab needs permission to read SMS. You can allow it in Settings > Apps > Hisaab > Permissions.');
        }
        return;
      }
      const alerts = queued();
      const counts = useLedger.getState().ingestCaptured([...alerts, ...messages]);
      const newest = messages.reduce((max, m) => Math.max(max, Date.parse(m.postedAt)), since);
      database().setSetting(SMS_READ_UNTIL, String(Math.max(newest, since)));
      if (announce) {
        Alert.alert(
          'SMS read',
          `${messages.length} messages about money: ${counts.recorded} payments recorded` +
            (counts.cashWithdrawals ? `, ${counts.cashWithdrawals} cash withdrawals` : '') +
            (counts.waiting ? `, ${counts.waiting} for accounts you have not added` : '') +
            '. The rest are sorted on the Messages screen.'
        );
      }
    } catch (e) {
      // Never fail silently: the first run on a real phone did, and nothing said why.
      if (announce) Alert.alert('Could not read your SMS', (e as Error).message ?? String(e));
      console.warn('SMS read failed');
      useLedger.getState().ingestCaptured(queued());
    } finally {
      if (announce) setReadingSms(false);
    }
  };

  // Alerts caught while the app was closed are waiting in the listener's
  // queue; read them whenever the app comes to the front. Notification access
  // can also change in Settings while the app is away, so re-check it then.
  const [captureOn, setCaptureOn] = useState(captureEnabled);
  const catchUp = () => {
    setCaptureOn(captureEnabled());
    const since = smsReadUntil();
    // With SMS on, the queue goes in with the SMS (readSms), so the screens redraw once.
    if (since !== null) void readSms(since, false);
    else if (useLedger.getState().ready) useLedger.getState().ingestCaptured(drainCaptured());
  };
  useEffect(() => {
    if (!ledger.ready) return;
    // After Home's first frame: catching up redraws every screen, so it waits until the
    // data that is already there is on screen.
    let first: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      first = setTimeout(catchUp, 0);
    });
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') catchUp();
    });
    // Alerts that arrive while the app is open are picked up within seconds.
    const tick = setInterval(() => {
      if (AppState.currentState === 'active') useLedger.getState().ingestCaptured(drainCaptured());
    }, 10_000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(first);
      sub.remove();
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger.ready]);

  // Onboarding runs until the user finishes it. Keyed on "no accounts" alone,
  // it vanished the moment the first account was added and skipped the
  // import step. An empty ledger (first launch, or after deleting
  // everything) starts it again.
  const [onboarding, setOnboarding] = useState(false);
  const noAccounts = ledger.ready && ledger.accounts.length === 0;
  useEffect(() => {
    if (noAccounts) setOnboarding(true);
  }, [noAccounts]);

  /**
   * Says what a statement import did, in counts the user can check: added, already here,
   * needing a category, the bank's closing balance; and offers to list exactly those entries.
   */
  const sayImported = (result: ImportResult) => {
    const account = ledger.accounts.find((a) => a.id === result.accountId);
    const label = account ? `${account.name}${account.last4 ? ` •••• ${account.last4}` : ''}` : 'Your account';
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const listed = result.rawId ? importedEntries(database(), result.rawId, 1).count : 0;
    const body = [
      result.from && result.to ? `${label}, ${datePeriod(result.from, result.to)}.` : `${label}.`,
      `${plural(result.rowsParsed, 'new transaction', 'new transactions')} added.`,
      result.duplicatesSkipped
        ? `${plural(result.duplicatesSkipped, 'was', 'were')} already in Hisaab (typed in, from Paisa, from bank messages or an earlier import), so not added again.`
        : '',
      result.rowsNeedingReview ? `${plural(result.rowsNeedingReview, 'needs', 'need')} a category.` : '',
      result.rowsWithError ? `${plural(result.rowsWithError, 'row', 'rows')} could not be added.` : '',
      result.closingBalance !== undefined && result.to
        ? `Balance on ${dateWithYear(result.to)}: ${showAmount(result.closingBalance)}, the statement's own figure.`
        : '',
    ].filter(Boolean);

    const buttons: AlertButton[] = [{ text: 'OK', style: 'cancel' }];
    if (result.rowsNeedingReview > 0) buttons.push({ text: 'Review', onPress: () => go({ screen: 'Review' }) });
    if (listed > 0 && result.rawId) {
      const rawId = result.rawId;
      buttons.push({ text: 'See them', onPress: () => openImported(rawId, label) });
    }
    Alert.alert(result.rowsParsed > 0 ? 'Statement imported' : 'Nothing new in this statement', body.join('\n\n'), buttons);
  };

  /** Imports text, and when it turned out to be a CAS, says so and shows the result. */
  const runImport = (text: string, sourceRef: string, source: 'statement_csv' | 'statement_pdf', accountId?: Id) => {
    const before = useLedger.getState().lastCas;
    const paisaBefore = useLedger.getState().lastPaisa;
    const statementBefore = useLedger.getState().lastImport;
    ledger.importText({ text, sourceRef, source, accountId });
    // Something came in: onboarding is over, and the alert's See them and Review can open their screens.
    const statement = useLedger.getState().lastImport;
    if (statement && statement !== statementBefore) {
      if (statement.rowsParsed > 0) setOnboarding(false);
      sayImported(statement);
      return;
    }
    const paisa = useLedger.getState().lastPaisa;
    if (paisa && paisa !== paisaBefore) {
      setOnboarding(false);
      const extra = [
        paisa.matched ? `${paisa.matched} were already here from your bank messages, and now carry your Paisa names.` : '',
        paisa.skipped ? `${paisa.skipped} were imported before.` : '',
        paisa.failed.length ? `${paisa.failed.length} could not be read (kept as they were).` : '',
      ].filter(Boolean).join(' ');
      Alert.alert(
        'Paisa history added',
        `${paisa.created} transactions from ${paisa.from ? `${shortDate(paisa.from)} ${paisa.from.slice(0, 4)}` : '?'} to ${paisa.to ? `${shortDate(paisa.to)} ${paisa.to.slice(0, 4)}` : '?'}, in ${paisa.accounts.join(' and ') || 'your accounts'}. ${extra}`.trim()
      );
      return;
    }
    const cas = useLedger.getState().lastCas;
    if (cas && cas !== before) {
      setOnboarding(false);
      Alert.alert(
        'Investments updated',
        `${cas.holdings} holdings from your ${cas.source}, worth ${showAmount(cas.total)} as of ${shortDate(cas.asOf)}.`
      );
      go({ screen: 'Wealth' });
    }
  };

  /** Reads a PDF into its layout and imports it, asking for a password if it is locked. */
  const importPdf = async (uri: string, fileName: string, password?: string) => {
    setReadingPdf(true);
    const read = await readPdfLayout(uri, password);
    setReadingPdf(false);

    if ('layout' in read) {
      setLockedPdf(undefined);
      const layout = readLayout(read.layout);
      // A CAS or a bank statement imports; any other PDF is read as a bill.
      if (isCas(read.layout) || !layout || PdfLayoutParser.parse(read.layout).isOk()) {
        runImport(read.layout, fileName, 'statement_pdf');
      } else {
        openBill(layoutText(layout).split('\n'), fileName);
      }
      return;
    }
    if (read.error === 'password_required' || read.error === 'wrong_password') {
      setLockedPdf({
        uri,
        fileName,
        error: read.error === 'wrong_password' ? 'That password did not open it.' : undefined,
      });
      return;
    }
    setLockedPdf(undefined);
    Alert.alert(
      'Could not read this PDF',
      read.error === 'unavailable'
        ? 'PDF import needs the development build of the app. CSV works everywhere.'
        : `${read.message}. If your bank offers a CSV download, that will work instead.`
    );
  };

  /** Shows what a bill says, for the user to confirm before anything is saved. */
  const openBill = (lines: string[], sourceRef: string) => {
    go({ screen: 'Bill', bill: parseBill(lines), text: lines.join('\n'), sourceRef });
  };

  /** A photo of a bill: read on the phone, then shown for confirming. */
  const readBillPhoto = async (uri: string, name: string) => {
    setReadingPdf(true);
    try {
      const boxes = await recognizeText(uri);
      openBill(rowsFromBoxes(boxes), name);
    } catch (e) {
      Alert.alert('Could not read this photo', (e as Error).message);
    } finally {
      setReadingPdf(false);
    }
  };

  /**
   * A file shared from another app, or picked: route it by what it is. A shared one comes
   * from whichever app chose to send it, so nothing is read or recorded until the user says yes.
   */
  // Transactions out as CSV, to a folder the user picks. Not encrypted, and it says so.
  /** One Financial report for a month, its figures made with `money`. */
  const buildReport = (kind: ReportKind, month: string | undefined, money: Money) => {
    const db = database();
    const today = new Date();
    const view = reportView(db, month, today, 'expense');
    if (kind === 'month-summary') return monthSummary(view, spendingCategoryNames(db), money);
    if (kind === 'cash-flow') return cashFlow(view, largestSpends(db, view.flow[0].key, view.month.key), money);
    return goalProgress(ledger.goals, isoDate(today), money);
  };

  /** Writes a report as a web page with the real figures, whatever the eye hides on screen. */
  const saveReport = async (kind: ReportKind, month: string | undefined) => {
    const doc = buildReport(kind, month, (amount) => rupees(amount));
    try {
      const saved = await saveTextFile(reportHtml(doc, dateWithYear(isoDate(new Date()))), `${doc.fileName}.html`, 'text/html');
      await whenActive();
      if (saved) Alert.alert('Saved', `${saved} is in the folder you chose. Open it in a browser; its Print makes a PDF. It is not encrypted: anyone who can open that folder can read it.`);
    } catch (e) {
      await whenActive();
      Alert.alert('Could not save the report', (e as Error).message);
    }
  };

  const exportCsv = async (query: string) => {
    const name = `hisaab-transactions-${isoDate(new Date())}.csv`;
    try {
      const saved = await saveTextFile(entriesCsv(database(), query), name, 'text/csv');
      await whenActive();
      if (saved) Alert.alert('Saved', `${saved} is in the folder you chose. It is not encrypted: anyone who can open that folder can read it.`);
    } catch (e) {
      await whenActive();
      Alert.alert('Could not save the file', (e as Error).message);
    }
  };

  // A bill shared as text only fills in the Recurring form; nothing is saved until the user does.
  const handleBillText = (text: string) => {
    const draft = readBillText(text, isoDate(new Date()));
    if (!draft) {
      Alert.alert('No bill found', 'Hisaab could not find an amount or a due date to pay in this text.');
      return;
    }
    go({ screen: 'Recurring', draft });
  };

  // Picked or shared: a Paisa backup and a CAS bring their own accounts; only a bank CSV needs one chosen.
  // The share listener keeps the render it was made in, so the accounts are read now, not from it.
  const importCsv = (text: string, fileName: string) => {
    if (needsAccountChoice(useLedger.getState().accounts) && !isPaisaBackup(text) && !isCas(text)) {
      setCsvToPlace({ text, fileName });
      return;
    }
    runImport(text, fileName, 'statement_csv');
  };

  const handleFile = async (file: SharedFile, options: { shared?: boolean } = {}) => {
    if (typeof file.text === 'string') return handleBillText(file.text);
    const name = file.name ?? 'shared file';
    if (options.shared && !(await confirmShared(name))) return;
    const type = file.mimeType ?? '';
    if (type.startsWith('image/')) return readBillPhoto(file.uri, name);
    if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return importPdf(file.uri, name);
    try {
      importCsv(await readSharedText(file.uri), name);
    } catch (e) {
      Alert.alert('Could not read this file', (e as Error).message);
    }
  };

  const confirmShared = (name: string): Promise<boolean> =>
    new Promise((resolve) => {
      const shown = shownFileName(name);
      Alert.alert(
        'Open a shared file?',
        `Another app is sending “${shown}” to Hisaab. It will be read on this phone, and a statement in it would be added to your ledger. Only continue if you sent it yourself.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Open it', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });

  const openReadBill = async () => {
    const picked = await File.pickFileAsync({ mimeTypes: ['image/*', 'application/pdf'] });
    if (picked.canceled) return;
    const file = picked.result;
    await handleFile({ uri: file.uri, name: file.name, mimeType: file.type || null });
  };

  const openImport = async () => {
    const picked = await pickStatement();
    if (!picked) return;

    if (picked.kind === 'pdf') {
      await importPdf(picked.uri, picked.fileName);
      return;
    }

    importCsv(picked.text, picked.fileName);
  };

  const backUp = async (passphrase: string): Promise<DataOutcome> => {
    const sealed = await ledger.backUp(passphrase, secureRandom);
    if ('error' in sealed) return { message: sealed.error, failed: true };
    try {
      const name = await saveBackupFile(sealed.file);
      if (!name) return null;
      ledger.markBackedUp();
      return {
        message: `Saved ${name}: ${sealed.entries} transactions, encrypted.`,
        failed: false,
      };
    } catch {
      return { message: 'Could not write to that folder. Try another one.', failed: true };
    }
  };

  const restore = async (passphrase: string): Promise<DataOutcome> => {
    let file: string | null;
    try {
      file = await pickBackupFile();
    } catch {
      return { message: 'Could not read that file.', failed: true };
    }
    if (file === null) return null;
    const failed = await ledger.restore(file, passphrase);
    if (failed) return { message: failed, failed: true };
    // Restored from onboarding: the ledger is full again, so onboarding is over.
    if (onboarding) {
      setOnboarding(false);
      switchTab('Home');
    }
    return { message: 'Backup restored.', failed: false };
  };

  const backup = backupStatus(ledger.lastBackup, ledger.backupSnoozedUntil, ledger.timeline.length > 0);

  const dataControls: DataControls = {
    onBackUp: backUp,
    onRestore: restore,
    onDeleteAll: (confirmation) => {
      const failed = ledger.deleteEverything(confirmation);
      if (!failed) discardAllProductPhotos();
      return failed;
    },
    minPassphrase: MIN_PASSPHRASE_LENGTH,
    deletePhrase: DELETE_CONFIRMATION,
    backupSummary: backup.sentence,
  };

  const openEntry = (entryId: string) => go({ screen: 'Detail', entryId: entryId as Id });

  /**
   * Remembers the payment, then opens a UPI app for it and waits for that app to close. What it says
   * on the way back is a note: only the bank's message (or the payer) settles the payment. If no UPI
   * app could open, nothing was handed over, so nothing is left waiting.
   */
  const payWithUpi = async (request: UpiRequest, amount: Paise, categoryId?: string): Promise<Outcome> => {
    const started = ledger.startPayment(request, amount, categoryId as Id | undefined);
    if (typeof started === 'string') return started;
    try {
      const answer = upiAnswer(await openUpi(upiLink(request, amount)));
      if (answer) ledger.notePaymentResult(started.id, answer);
      return undefined;
    } catch (e) {
      ledger.cancelPayment(started.id);
      return (e as Error).message ?? 'A UPI app could not be opened.';
    }
  };

  const categoryIdFor = (name: string): Id | undefined =>
    DEFAULT_CATEGORIES.find((c) => c.name === name)?.id as Id | undefined;

  if (locked && !LOCK_OFF_FOR_DEVELOPMENT) {
    return (
      <SafeAreaView className={t.screen}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <LockScreen onUnlock={tryUnlock} note={lockNote} />
      </SafeAreaView>
    );
  }

  const pdfSheet = (
    <PdfPasswordSheet
      key={lockedPdf?.uri ?? 'none'}
      fileName={lockedPdf?.fileName}
      error={lockedPdf?.error}
      busy={readingPdf}
      onSubmit={(password) => lockedPdf && importPdf(lockedPdf.uri, lockedPdf.fileName, password)}
      onCancel={() => setLockedPdf(undefined)}
    />
  );

  const chooseSheet = (
    <ChooseAccountSheet
      fileName={csvToPlace?.fileName}
      accounts={statementTargets(ledger.accounts)}
      onChoose={(account) => {
        const waiting = csvToPlace;
        setCsvToPlace(undefined);
        if (waiting) runImport(waiting.text, waiting.fileName, 'statement_csv', account.id as Id);
      }}
      onCancel={() => setCsvToPlace(undefined)}
    />
  );

  if (!ledger.ready) {
    return (
      <SafeAreaView className={`${t.screen} items-center justify-center px-8`}>
        {opening.error ? (
          <>
            <Text className={`${t.heading} text-center`}>Hisaab could not open your data</Text>
            <Text className={`${t.muted} mt-2 text-center leading-5`}>{opening.error}</Text>
            <View className="mt-6 self-stretch">
              <PrimaryButton label="Try again" onPress={openData} />
            </View>
          </>
        ) : (
          <>
            <ActivityIndicator color={ink} />
            <Text className={`${t.muted} mt-4 text-center leading-5`}>
              {opening.moving
                ? 'Encrypting your data. This happens once and can take a minute; keep the app open.'
                : 'Opening your data'}
            </Text>
            {!opening.moving && (
              <View className="mt-6 self-stretch opacity-60">
                <LoadingSkeleton rows={2} />
              </View>
            )}
          </>
        )}
      </SafeAreaView>
    );
  }

  if (onboarding || noAccounts) {
    return (
      <SafeAreaView className={t.screen}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <OnboardingScreen
            onAddAccount={(name, last4) => ledger.addAccount(name, last4)}
            onImport={openImport}
            onComplete={() => {
              setOnboarding(false);
              switchTab('Home');
            }}
            onRestore={restore}
          />
        </KeyboardAvoidingView>
        {pdfSheet}
        {chooseSheet}
      </SafeAreaView>
    );
  }

  // Screens that read the database directly re-read on every render; the
  // store's version bump after each change is what triggers one.
  const db = database();

  /** What the accounts hold, from the safe-to-spend lines (the same figure the breakdown shows). */
  const liquidOf = (view: typeof ledger.safeToSpend): Paise | undefined =>
    view.status === 'ready' ? view.result.lines.find((l) => l.kind === 'liquid')?.amount : undefined;

  // The faint mood behind Home: from the charge, what is due this week, and budgets already over.
  const dueSoon = ledger.recurring
    .filter((r) => r.nextDue <= isoDate(addDays(new Date(), 7)))
    .reduce((total, r) => total + r.amount, 0);
  const liquid = liquidOf(ledger.safeToSpend);
  const homeWeather =
    ledger.safeToSpend.status === 'ready' && liquid !== undefined
      ? weatherOf({
          charge: chargeOf(ledger.safeToSpend.result.amount, liquid),
          free: ledger.safeToSpend.result.amount,
          dueSoon,
          overBudgets: ledger.budgets.filter((b) => b.over).length,
        })
      : 'normal';

  const body = () => {
    switch (route.screen) {
      case 'Home':
        return (
          <HomeScreen
            month={monthLabel()}
            summary={ledger.summary}
            lastMonth={ledger.lastMonth}
            spendByDay={ledger.spendByDay}
            spendingScore={ledger.spendingScore}
            topCategories={ledger.topCategories}
            recentEntries={ledger.recent}
            reviewCount={ledger.reviewCards.length}
            suspenseRatio={ledger.suspenseRatio}
            onReviewPress={() => go({ screen: 'Review' })}
            onCategoryPress={openActivity}
            onSeeAllPress={() => switchTab('Activity')}
            onEntryPress={openEntry}
            safeToSpend={
              ledger.safeToSpend.status === 'ready'
                ? {
                    amount: ledger.safeToSpend.result.amount,
                    until: ledger.safeToSpend.nextIncome,
                    days: ledger.safeToSpend.result.daysInWindow,
                    usualDaily: ledger.safeToSpend.basisDays > 0 ? ledger.safeToSpend.dailyDiscretionary : undefined,
                    liquid: liquidOf(ledger.safeToSpend),
                  }
                : 'needs_payday'
            }
            onSafeToSpendPress={() => go({ screen: 'SafeToSpend' })}
            change={
              ledger.insights.insights[0]
                ? {
                    kind: ledger.insights.insights[0].kind,
                    sentence: ledger.insights.insights[0].sentence,
                    onPress: () => go({ screen: 'Insights' }),
                  }
                : undefined
            }
            hero={
              <WealthHero
                wealth={ledger.wealth}
                monthNet={ledger.summary.net}
                onRefresh={() => go({ screen: 'Wealth' })}
                onOpen={() => go({ screen: 'Wealth' })}
                onLock={() => moveLock({ locked: true, backgroundedAt: null })}
                onProfile={() => go({ screen: 'Settings' })}
                onScan={() => go({ screen: 'ScanPay' })}
              />
            }
            payments={{
              items: ledger.payments,
              accounts: upiAccounts(db),
              onPaid: (id, accountId) => ledger.confirmPaid(id, accountId as Id),
              onNotPaid: (id) => ledger.cancelPayment(id),
            }}
            mandates={ledger.mandates}
            onConfirmMandate={(key, details) => ledger.confirmMandate(key, details)}
            onDismissMandate={(key) => ledger.dismissMandate(key)}
            onMessagesPress={() => go({ screen: 'Messages' })}
            scamCount={messagesView(db).counts.scam}
            onBudgetsPress={() => go({ screen: 'Budgets' })}
            budgetsOverCount={ledger.budgets.filter((b) => b.over).length}
            onRecurringPress={() => go({ screen: 'Recurring' })}
            recurringDueCount={
              ledger.recurring.filter((r) => r.nextDue <= isoDate(addDays(new Date(), 7))).length
            }
            backup={
              backup.due
                ? { sentence: backup.sentence, onOpen: () => go({ screen: 'Settings' }), onLater: ledger.snoozeBackup }
                : undefined
            }
            waiting={
              ledger.waitingAccounts.length > 0
                ? { accounts: ledger.waitingAccounts, onAdd: () => go({ screen: 'Accounts' }) }
                : undefined
            }
            capture={
              captureAvailable && !captureOn
                ? { onEnable: openCaptureSettings }
                : undefined
            }
            twice={
              ledger.maybeTwice.length > 0
                ? {
                    pair: ledger.maybeTwice[0],
                    count: ledger.maybeTwice.length,
                    onSame: () => {
                      const problem = ledger.sameAsBank(ledger.maybeTwice[0]);
                      if (problem) Alert.alert('Could not keep one', problem);
                    },
                    onTwo: () => {
                      const problem = ledger.twoPayments(ledger.maybeTwice[0]);
                      if (problem) Alert.alert('Could not save that', problem);
                    },
                  }
                : undefined
            }
            cash={
              ledger.cash.unexplained > 0 && ledger.cash.accountId
                ? {
                    unexplained: ledger.cash.unexplained,
                    onExplain: () =>
                      go({
                        screen: 'AddTransaction',
                        preset: { kind: 'expense', accountId: ledger.cash.accountId },
                      }),
                    onKeep: () => ledger.keepCash(),
                  }
                : undefined
            }
          />
        );

      case 'More':
        return (
          <MoreScreen
            onOpen={(target: MoreTarget) => go({ screen: target })}
            notes={{
              Budgets: ledger.budgets.some((b) => b.over)
                ? `${ledger.budgets.filter((b) => b.over).length} over this month`
                : undefined,
              Messages: messagesView(db).counts.scam ? `${messagesView(db).counts.scam} flagged as scams` : undefined,
              Subscriptions: ledger.subscriptions.active.length ? `${ledger.subscriptions.active.length} found` : undefined,
              Insights: ledger.insights.insights.length ? `${ledger.insights.insights.length} to look at` : undefined,
              Goals: ledger.goals.length ? `${ledger.goals.length} in progress` : undefined,
            }}
          />
        );

      case 'SafeToSpend':
        return (
          <SafeToSpendScreen
            view={ledger.safeToSpend}
            onSetPayday={ledger.setPayday}
            onSetCashFloor={ledger.setCashFloor}
          />
        );

      case 'Subscriptions':
        return <SubscriptionsScreen view={ledger.subscriptions} />;

      case 'Insights':
        return <InsightsScreen view={ledger.insights} onEntryPress={openEntry} />;

      case 'Activity':
        return (
          <TimelineScreen
            key={route.query ?? ''}
            initialQuery={route.query}
            entries={ledger.timeline}
            onEntryPress={openEntry}
            onSearch={(query) => searchEntries(db, query)}
            onExport={(query) => void exportCsv(query)}
          />
        );

      case 'Items':
        return (
          <ItemsScreen
            month={monthLabel()}
            inventory={ledger.inventory}
            prices={ledger.priceStories}
            onPricePress={openActivity}
            onProductPress={(productId) => go({ screen: 'Product', productId })}
            onAddPurchase={() => go({ screen: 'AddPurchase' })}
            onReadBill={openReadBill}
          />
        );

      case 'Accounts':
        return (
          <AccountsScreen
            accounts={ledger.accounts}
            wealth={ledger.wealth}
            waiting={ledger.waitingAccounts}
            onAddAccount={(name, last4, balance) => ledger.addAccount(name, last4, balance)}
            onEditAccount={(id, name, last4, balance) => ledger.editAccount(id as Id, name, last4, balance)}
            onExcludeAccount={(id, excluded) => ledger.setAccountExcluded(id as Id, excluded)}
            onDeleteAccount={(id) => ledger.deleteAccount(id as Id)}
            onImportStatement={openImport}
            onRecordTransaction={() => go({ screen: 'AddTransaction' })}
            onOpenWealth={() => go({ screen: 'Wealth' })}
            imports={statementImports(db)}
            onImportPress={(item) => openImported(item.rawId, item.account ?? namedFile(item.fileName) ?? 'Statement')}
          />
        );

      case 'ReportDoc':
        return (
          <ReportDocScreen
            doc={buildReport(route.kind, route.month, (amount) => showAmount(amount))}
            onSave={() => saveReport(route.kind, route.month)}
          />
        );

      case 'Imported': {
        const listed = importedEntries(db, route.rawId);
        return (
          <TimelineScreen
            key={route.rawId}
            title="Imported"
            subtitle={route.title}
            entries={listed.days}
            summary={listed}
            onEntryPress={openEntry}
          />
        );
      }

      case 'Settings':
        return (
          <SettingsScreen
            theme={ledger.theme}
            onThemeChange={ledger.setTheme}
            onMotionChange={ledger.setMotion}
            onSoundChange={ledger.setSound}
            onHapticsChange={ledger.setHaptics}
            data={dataControls}
            lockOn={!LOCK_OFF_FOR_DEVELOPMENT}
          />
        );

      case 'Review':
        return (
          <ReviewQueueScreen
            cards={ledger.reviewCards}
            onAccept={(cardId, category) => {
              const categoryId = categoryIdFor(category);
              if (!categoryId) return;
              ledger.correct({ entryId: cardId as Id, categoryId, applyToAll: true });
            }}
            onDone={back}
          />
        );

      case 'Detail': {
        const detail = entryDetail(db, route.entryId);
        if (!detail) return null;

        const itemisation = itemisationOf(db, route.entryId);
        // Only money going out bought anything worth itemising.
        const canItemise = isNegative(detail.amount);

        return (
          <TransactionDetailScreen
            key={route.entryId}
            date={detail.date}
            merchant={detail.merchant}
            category={detail.category}
            amount={detail.amount}
            account={detail.account}
            narration={detail.narration}
            notes={detail.notes}
            matchCount={detail.matchCount}
            itemised={
              itemisation
                ? {
                    itemised: itemisation.itemised,
                    remaining: itemisation.remaining,
                    lines: itemisation.lines.map(({ purchase, product }) => ({
                      id: purchase.id,
                      name: product.name,
                      quantity: formatQuantity(purchase.quantity, product.unit),
                      amount: purchase.amount,
                    })),
                  }
                : undefined
            }
            onItemise={
              canItemise
                ? () => go({ screen: 'AddPurchase', entryId: route.entryId })
                : undefined
            }
            onCategoryChange={(category) => {
              const categoryId = categoryIdFor(category);
              if (categoryId) ledger.correct({ entryId: detail.id, categoryId });
            }}
            onApplyToAll={(category) => {
              const categoryId = categoryIdFor(category);
              if (!categoryId) return;
              ledger.correct({ entryId: detail.id, categoryId, applyToAll: true });
              back();
            }}
            onSave={(notes) => {
              if ((detail.notes ?? '') !== notes.trim()) ledger.setEntryNotes(detail.id, notes);
              back();
            }}
            canDelete={detail.canDelete}
            onDelete={() => {
              ledger.removeEntry(detail.id);
              back();
            }}
          />
        );
      }

      case 'Product': {
        const detail = productDetail(db, route.productId);
        if (!detail) return null;
        const productId = route.productId;

        return (
          <ProductScreen
            key={productId}
            detail={detail}
            onLogUse={(input) => ledger.logUse({ ...input, productId })}
            onCount={(input) => ledger.countLeft({ ...input, productId })}
            onBuyMore={() => go({ screen: 'AddPurchase', productId })}
            onToggleStaple={(isStaple) => ledger.setStaple(productId, isStaple)}
            onEdit={(patch) => ledger.editProduct(productId, patch)}
            onPickPhoto={pickProductPhoto}
            onDropPhoto={discardProductPhoto}
            onRemovePurchase={ledger.removePurchase}
            onRemoveConsumption={ledger.removeConsumption}
          />
        );
      }

      case 'AddPurchase': {
        const entry = route.entryId ? entryDetail(db, route.entryId) : null;
        const itemisation = route.entryId ? itemisationOf(db, route.entryId) : null;
        const owned = (db.getAllAccounts().getOrNull() ?? []).filter(
          (a) => !a.isSystem && a.kind === 'asset' && a.subkind !== 'investment'
        );
        const payFrom = [...owned.filter((a) => a.subkind === 'cash'), ...owned.filter((a) => a.subkind !== 'cash')];

        return (
          <AddPurchaseScreen
            key={`${route.productId ?? ''}${route.entryId ?? ''}`}
            products={listProducts(db)}
            presetProductId={route.productId}
            accounts={payFrom.map((a) => ({ id: a.id, name: a.name }))}
            hintFor={(productId) => lastPurchaseOf(db, productId)}
            usual={(needle) => usualPurchases(db, needle)}
            onPickPhoto={pickProductPhoto}
            onDropPhoto={discardProductPhoto}
            itemising={
              entry && itemisation
                ? {
                    entryId: itemisation.entryId,
                    merchant: entry.merchant,
                    date: entry.date.slice(0, 10),
                    total: itemisation.total,
                    remaining: itemisation.remaining,
                  }
                : undefined
            }
            onSave={ledger.addPurchase}
            onDone={back}
          />
        );
      }

      case 'Bill': {
        const owned = (db.getAllAccounts().getOrNull() ?? []).filter(
          (a) => !a.isSystem && a.kind === 'asset' && a.subkind !== 'investment'
        );
        const payFrom = [
          ...owned.filter((a) => a.subkind === 'cash'),
          ...owned.filter((a) => a.subkind !== 'cash'),
        ];
        return (
          <BillScreen
            bill={route.bill}
            matches={billMatches(db, route.bill)}
            accounts={payFrom.map((a) => ({ id: a.id, name: a.name }))}
            onSave={(target, indexes) =>
              ledger.saveBill({
                bill: route.bill,
                text: route.text,
                sourceRef: route.sourceRef,
                entryId: target.kind === 'entry' ? target.entryId : undefined,
                recordFrom: target.kind === 'new' ? target.accountId : undefined,
                items: indexes.map((i) => route.bill.items[i]),
              })
            }
            onDone={() => setStack([{ screen: 'Home' }, { screen: 'Items' }])}
          />
        );
      }

      case 'Messages':
        return (
          <MessagesScreen
            view={messagesView(db)}
            onReadHistory={smsReadUntil() === null ? () => readSms(0, true) : undefined}
            readingHistory={readingSms}
          />
        );

      case 'Wealth':
        return <WealthScreen wealth={ledger.wealth} onImportCas={openImport} />;

      case 'Goals':
        return (
          <GoalsScreen
            goals={ledger.goals}
            onAdd={(name, targetAmount, targetDate) => ledger.addGoal({ name, targetAmount, targetDate })}
            onContribute={(id, amount) => ledger.addToGoal(id as Id, amount)}
            onEdit={(id, name, targetAmount, targetDate) =>
              ledger.editGoal(id as Id, { name, targetAmount, targetDate: targetDate ?? null })
            }
            onDelete={(id) => ledger.removeGoal(id as Id)}
          />
        );

      case 'Recurring':
        return (
          <RecurringScreen
            items={ledger.recurring}
            onAdd={(name, amount, cadence, nextDue, note) =>
              ledger.addRecurring({ name, amount, cadence, nextDue, note })
            }
            onMarkPaid={(id) => ledger.markRecurringPaid(id as Id)}
            onDelete={(id) => ledger.removeRecurring(id as Id)}
            draft={route.draft}
          />
        );

      case 'Reports':
        return (
          <ReportsScreen
            view={reportView(db, reportMonth, new Date(), reportSide)}
            onSideChange={setReportSide}
            onCategoryPress={openActivity}
            onReportPress={(kind) => go({ screen: 'ReportDoc', kind, month: reportMonth })}
            flowFor={(name) => categoryFlow(db, reportView(db, reportMonth, new Date(), 'expense').month.key, name)}
            storyFor={() => {
              const spending = reportView(db, reportMonth, new Date(), 'expense');
              return {
                monthName: spending.month.label.split(' ')[0],
                year: spending.month.label.split(' ')[1] ?? '',
                received: spending.income,
                spent: spending.expense,
                transactions: spending.transactions,
                categories: spending.categories.map((c) => ({ name: c.name, amount: c.amount, percentage: c.percentage })),
              };
            }}
            onMonthChange={setReportMonth}
            onEntryPress={openEntry}
          />
        );

      case 'Budgets':
        return (
          <BudgetsScreen
            budgets={ledger.budgets}
            categories={EXPENSE_CATEGORIES.map((c) => ({ id: c.id, name: c.name }))}
            onAdd={(categoryId, amount) => ledger.addBudget(categoryId as Id, amount)}
            onEdit={(id, amount) => ledger.editBudget(id as Id, amount)}
            onDelete={(id) => ledger.removeBudget(id as Id)}
            onRollover={(id, on) => ledger.setBudgetRollover(id as Id, on)}
            onOpened={ledger.noticeKeptBudgets}
          />
        );

      case 'ScanPay':
        return (
          <ScanPayScreen
            scan={scanCode}
            categories={EXPENSE_CATEGORIES.map((c) => ({ id: c.id, name: c.name }))}
            suggestCategory={(request) => suggestedCategory(db, request)}
            onPay={payWithUpi}
            onDone={back}
          />
        );

      case 'AddTransaction': {
        const accounts = (db.getAllAccounts().getOrNull() ?? []).filter(
          (a) => !a.isSystem && a.kind === 'asset' && a.subkind !== 'investment'
        );

        return (
          <AddTransactionScreen
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            categories={EXPENSE_CATEGORIES}
            onSave={ledger.recordManual}
            onDone={back}
            preset={route.preset}
          />
        );
      }
    }
  };

  const isTab = TABS.includes(route.screen as Tab);

  /** The "+" in the tab bar: pick what to add, then land on the right form. */
  const startAdding = (kind: AddKind) => {
    setAdding(false);
    if (kind === 'purchase') return go({ screen: 'AddPurchase' });
    go({ screen: 'AddTransaction', preset: { kind } });
  };

  return (
    <SafeAreaView className={t.screen}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      {route.screen === 'Home' && <MoneyWeather weather={homeWeather} />}

      {!isTab && (
        <View className={`${t.page} pt-2`}>
          <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} className="flex-row items-center self-start py-2 pr-4">
            <Icon name="back" size={20} color={colors.textSecondary} />
            <Text className={`${t.muted} ml-0.5`}>Back</Text>
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <RouteTransition key={routeKey} origin={origin}>
          {body()}
        </RouteTransition>
      </KeyboardAvoidingView>

      {pdfSheet}
      {chooseSheet}

      {(ledger.busy || readingPdf) && (
        <View className={`${t.page} pb-4`}>
          <Text className={`${t.faint} text-center`}>{readingPdf ? 'Reading PDF…' : 'Importing…'}</Text>
        </View>
      )}

      {isTab && (
        <AppTabBar
          tabs={[
            { key: 'Home', label: 'Home', icon: 'home' },
            { key: 'Activity', label: 'Activity', icon: 'activity' },
            { key: 'Reports', label: 'Reports', icon: 'reports' },
            { key: 'More', label: 'More', icon: 'more' },
          ]}
          current={route.screen as Tab}
          onChange={switchTab}
          onAdd={() => setAdding(true)}
        />
      )}

      <AddSheet visible={adding} onClose={() => setAdding(false)} onPick={startAdding} />
    </SafeAreaView>
  );
};
