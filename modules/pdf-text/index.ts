import { requireOptionalNativeModule } from 'expo';

type PdfTextNative = {
  extractLayout(uri: string, password: string | null): Promise<string>;
};

/** Absent in Expo Go and on the web; present in the Android development build. */
const native = requireOptionalNativeModule<PdfTextNative>('PdfText');

export type PdfReadError = 'password_required' | 'wrong_password' | 'unreadable' | 'unavailable';

export type PdfReadResult = { layout: string } | { error: PdfReadError; message: string };

/** Reads a PDF on the phone into the layout JSON the statement parser takes. */
export const readPdfLayout = async (
  uri: string,
  password?: string
): Promise<PdfReadResult> => {
  if (!native) {
    return { error: 'unavailable', message: 'PDF reading needs the development build' };
  }
  try {
    return { layout: await native.extractLayout(uri, password ?? null) };
  } catch (e) {
    const code = (e as { code?: string }).code;
    const message = (e as Error).message ?? 'Could not read the PDF';
    if (code === 'ERR_PDF_PASSWORD') return { error: 'password_required', message };
    if (code === 'ERR_PDF_WRONG_PASSWORD') return { error: 'wrong_password', message };
    return { error: 'unreadable', message };
  }
};
