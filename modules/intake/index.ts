import { requireOptionalNativeModule } from 'expo';

type EventSubscription = { remove(): void };

/** A shared file, or shared text (`text` set, `uri` empty) such as an SMS or WhatsApp message. */
export type SharedFile = { uri: string; mimeType: string | null; name: string | null; text?: string | null };

/** A line of text read from a photo, with its box: [left, top, right, bottom]. */
export type OcrLine = { text: string; box: [number, number, number, number] };

/** What a launcher shortcut opens: the code scanner, the purchase form or the transaction form. */
export type Shortcut = 'scan' | 'purchase' | 'transaction';

type IntakeNative = {
  takeShared(): SharedFile | null;
  takeShortcut(): Shortcut | null;
  takePhoto(): Promise<string | null>;
  scanCode(): Promise<string | null>;
  openUpi(link: string): Promise<string>;
  addListener(event: 'onShortcut', listener: (event: { name: Shortcut }) => void): EventSubscription;
  readText(uri: string): Promise<string>;
  recognizeText(uri: string): Promise<string>;
  addListener(event: 'onShare', listener: (file: SharedFile) => void): EventSubscription;
};

/** Absent in Expo Go and on the web; present in the Android development build. */
const native = requireOptionalNativeModule<IntakeNative>('Intake');

/** The file another app shared to Hisaab, once; null when there is none. */
export const takeShared = (): SharedFile | null => native?.takeShared() ?? null;

/** Calls back when a file is shared while the app is already open. */
export const onShare = (listener: (file: SharedFile) => void): (() => void) => {
  const subscription = native?.addListener('onShare', listener);
  return () => subscription?.remove();
};

// A build made before shortcuts existed has no such function; it simply has no shortcuts.
const hasShortcuts = typeof native?.takeShortcut === 'function';

/** The launcher shortcut the app was opened with, once; null when there is none. */
export const takeShortcut = (): Shortcut | null => (hasShortcuts ? native!.takeShortcut() : null);

/** Calls back when a launcher shortcut is used while the app is already open. */
export const onShortcut = (listener: (name: Shortcut) => void): (() => void) => {
  const subscription = hasShortcuts ? native!.addListener('onShortcut', (event) => listener(event.name)) : undefined;
  return () => subscription?.remove();
};

/**
 * Opens the phone's camera app for one picture. Resolves with the picture's file:// address, or
 * null if the user backs out. The file is in the app's cache: move it, then delete it.
 */
export const takePhoto = (): Promise<string | null> =>
  native && typeof native.takePhoto === 'function'
    ? native.takePhoto()
    : Promise.reject(new Error('Taking a photo needs the latest build of the app'));

/**
 * Opens the code scanner for one QR code. Resolves with the code's text, or null if the user
 * backs out. Rejects when the scanner cannot open (Google Play services missing or not ready).
 */
export const scanCode = (): Promise<string | null> =>
  native && typeof native.scanCode === 'function'
    ? native.scanCode()
    : Promise.reject(new Error('Scanning needs the latest build of the app'));

/**
 * Hands a payment link to the phone's UPI apps. Resolves, when that app closes, with what it said
 * ("" if nothing): its word only, not proof the money moved.
 */
export const openUpi = (link: string): Promise<string> =>
  native && typeof native.openUpi === 'function'
    ? native.openUpi(link)
    : Promise.reject(new Error('Paying needs the latest build of the app'));

export const readSharedText = (uri: string): Promise<string> =>
  native ? native.readText(uri) : Promise.reject(new Error('Needs the development build'));

/** Text in a photo, read on the phone. */
export const recognizeText = async (uri: string): Promise<OcrLine[]> => {
  if (!native) throw new Error('Reading photos needs the development build');
  return JSON.parse(await native.recognizeText(uri)) as OcrLine[];
};
