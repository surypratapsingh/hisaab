import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { Result, ok, err } from '@/lib/result';
import { utf8Encode, utf8Decode, toBase64, fromBase64 } from '@/lib/bytes';

/**
 * Backups leave the phone — into Drive, email, a laptop — so the file itself
 * is encrypted with a key only the user's passphrase can produce. Nothing is
 * stored: lose the passphrase and the backup is unreadable, by design.
 *
 * scrypt turns the passphrase into a 256-bit key; AES-256-GCM encrypts and
 * authenticates the backup. The header (format, parameters, salt, nonce) is
 * bound in as associated data, so editing any of it fails decryption too.
 */

export const ENCRYPTED_FORMAT = 'money-os-backup';
// Only new backups are held to this; older backups made with a shorter passphrase still open.
export const MIN_PASSPHRASE_LENGTH = 12;

export type KdfParams = { N: number; r: number; p: number };

/** 32 MiB of memory per derivation: slow to guess, still fine on a mid phone. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 15, r: 8, p: 1 };

/** A file asking for more than this is refused rather than allowed to hang the app. */
const MAX_KDF: KdfParams = { N: 2 ** 18, r: 8, p: 2 };

/** Supplies secure random bytes: expo-crypto on the phone, node:crypto in tests. */
export type RandomSource = (length: number) => Uint8Array;

export type EncryptionError = {
  code: 'WEAK_PASSPHRASE' | 'NOT_ENCRYPTED' | 'UNSUPPORTED' | 'WRONG_PASSPHRASE';
  message: string;
};

type Header = {
  format: typeof ENCRYPTED_FORMAT;
  version: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  cipher: 'aes-256-gcm';
  nonce: string;
};

type Envelope = Header & { data: string };

/** The same fields in the same order every time, so both sides bind identical bytes. */
const headerBytes = (h: Header): Uint8Array =>
  utf8Encode(
    JSON.stringify([h.format, h.version, h.kdf, h.N, h.r, h.p, h.salt, h.cipher, h.nonce])
  );

const deriveKey = (passphrase: string, salt: Uint8Array, kdf: KdfParams) =>
  scryptAsync(utf8Encode(passphrase), salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 });

const readEnvelope = (file: string): Envelope | null => {
  try {
    const parsed = JSON.parse(file) as Partial<Envelope>;
    return parsed && parsed.format === ENCRYPTED_FORMAT ? (parsed as Envelope) : null;
  } catch {
    return null;
  }
};

/** True when a file is an encrypted backup rather than a plain export. */
export const isEncryptedBackup = (file: string): boolean => readEnvelope(file) !== null;

export const encryptBackup = async (
  plaintext: string,
  passphrase: string,
  random: RandomSource,
  kdf: KdfParams = DEFAULT_KDF
): Promise<Result<string, EncryptionError>> => {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return err({
      code: 'WEAK_PASSPHRASE',
      message: `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters`,
    });
  }

  const salt = random(16);
  const nonce = random(12);
  const header: Header = {
    format: ENCRYPTED_FORMAT,
    version: 1,
    kdf: 'scrypt',
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    salt: toBase64(salt),
    cipher: 'aes-256-gcm',
    nonce: toBase64(nonce),
  };

  const key = await deriveKey(passphrase, salt, kdf);
  const sealed = gcm(key, nonce, headerBytes(header)).encrypt(utf8Encode(plaintext));
  key.fill(0);

  const envelope: Envelope = { ...header, data: toBase64(sealed) };
  return ok(JSON.stringify(envelope));
};

export const decryptBackup = async (
  file: string,
  passphrase: string
): Promise<Result<string, EncryptionError>> => {
  const envelope = readEnvelope(file);
  if (!envelope) {
    return err({ code: 'NOT_ENCRYPTED', message: 'This is not an encrypted Hisaab backup' });
  }

  const supported =
    envelope.version === 1 && envelope.kdf === 'scrypt' && envelope.cipher === 'aes-256-gcm';
  const sane =
    [envelope.N, envelope.r, envelope.p].every((n) => Number.isInteger(n) && n > 0) &&
    envelope.N > 1 &&
    (envelope.N & (envelope.N - 1)) === 0 &&
    envelope.N <= MAX_KDF.N &&
    envelope.r <= MAX_KDF.r &&
    envelope.p <= MAX_KDF.p;
  if (!supported || !sane) {
    return err({
      code: 'UNSUPPORTED',
      message: 'This backup was made in a way this version cannot read',
    });
  }

  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const salt = fromBase64(text(envelope.salt));
  const nonce = fromBase64(text(envelope.nonce));
  const sealed = fromBase64(text(envelope.data));
  if (!salt || salt.length < 16 || !nonce || nonce.length !== 12 || !sealed || sealed.length < 16) {
    return err({ code: 'NOT_ENCRYPTED', message: 'The backup file is damaged' });
  }

  const key = await deriveKey(passphrase, salt, envelope);
  try {
    const opened = gcm(key, nonce, headerBytes(envelope)).decrypt(sealed);
    return ok(utf8Decode(opened));
  } catch {
    // GCM cannot tell a wrong key from an edited file; both fail the tag.
    return err({
      code: 'WRONG_PASSPHRASE',
      message: 'Wrong passphrase, or the file has been changed since it was made',
    });
  } finally {
    key.fill(0);
  }
};
