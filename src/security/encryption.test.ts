import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  DEFAULT_KDF,
  type KdfParams,
} from './encryption';

const random = (length: number) => new Uint8Array(randomBytes(length));

/** Cheap parameters so the suite stays fast; one test below uses the real ones. */
const FAST: KdfParams = { N: 2 ** 10, r: 8, p: 1 };

const PASS = 'correct horse battery';
const BACKUP = JSON.stringify({ version: 3, note: 'paneer ₹90, 🍞', entries: [1, 2, 3] });

const sealed = async (text = BACKUP) =>
  (await encryptBackup(text, PASS, random, FAST)).getOrNull()!;

describe('backup encryption', () => {
  it('round-trips a backup with the right passphrase', async () => {
    const file = await sealed();
    const opened = await decryptBackup(file, PASS);
    expect(opened.getOrNull()).toBe(BACKUP);
  });

  it('leaves nothing readable in the file', async () => {
    const file = await sealed();
    expect(file).not.toContain('paneer');
    expect(file).not.toContain('entries');
    expect(isEncryptedBackup(file)).toBe(true);
    expect(isEncryptedBackup(BACKUP)).toBe(false);
  });

  it('refuses the wrong passphrase', async () => {
    const opened = await decryptBackup(await sealed(), 'wrong horse battery');
    expect(opened.isErr() && opened.error.code).toBe('WRONG_PASSPHRASE');
  });

  it('refuses a short passphrase before doing any work', async () => {
    const result = await encryptBackup(BACKUP, 'short', random, FAST);
    expect(result.isErr() && result.error.code).toBe('WEAK_PASSPHRASE');
  });

  it('never produces the same file twice', async () => {
    expect(await sealed()).not.toBe(await sealed());
  });

  it('notices a single changed byte in the data', async () => {
    const envelope = JSON.parse(await sealed());
    const data: string = envelope.data;
    const flipped = (data[10] === 'A' ? 'B' : 'A');
    envelope.data = data.slice(0, 10) + flipped + data.slice(11);

    const opened = await decryptBackup(JSON.stringify(envelope), PASS);
    expect(opened.isErr() && opened.error.code).toBe('WRONG_PASSPHRASE');
  });

  it('notices an edited header, because the header is authenticated', async () => {
    const envelope = JSON.parse(await sealed());
    envelope.r = 4; // still a legal parameter, but not the one it was made with

    const opened = await decryptBackup(JSON.stringify(envelope), PASS);
    expect(opened.isErr()).toBe(true);
  });

  it('refuses parameters that would hang or crash the phone', async () => {
    const envelope = JSON.parse(await sealed());
    for (const N of [2 ** 30, 1000, 0, -1]) {
      const opened = await decryptBackup(JSON.stringify({ ...envelope, N }), PASS);
      expect(opened.isErr() && opened.error.code).toBe('UNSUPPORTED');
    }
  });

  it('calls a plain export or junk not encrypted, and a truncated file damaged', async () => {
    const plain = await decryptBackup(BACKUP, PASS);
    expect(plain.isErr() && plain.error.code).toBe('NOT_ENCRYPTED');

    const envelope = JSON.parse(await sealed());
    const truncated = await decryptBackup(JSON.stringify({ ...envelope, data: 'AAAA' }), PASS);
    expect(truncated.isErr() && truncated.error.code).toBe('NOT_ENCRYPTED');

    const typed = await decryptBackup(JSON.stringify({ ...envelope, salt: 42 }), PASS);
    expect(typed.isErr()).toBe(true);
  });

  it('works at the real strength, within a few seconds', async () => {
    const started = Date.now();
    const file = (await encryptBackup(BACKUP, PASS, random, DEFAULT_KDF)).getOrNull()!;
    expect(JSON.parse(file).N).toBe(DEFAULT_KDF.N);
    expect((await decryptBackup(file, PASS)).getOrNull()).toBe(BACKUP);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 20_000);
});
