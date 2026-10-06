import { factory } from 'ulid';

export type Id = string & { readonly __brand: 'Id' };

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * ulid finds its own randomness by looking for window.crypto or Node's
 * crypto module. React Native has neither, and there it crashed with
 * "undefined is not a function". So randomness comes from the standard
 * crypto.getRandomValues, which Node provides in tests and
 * src/ui/polyfills.ts provides on the phone (through expo-crypto).
 */
const secureByte = (): number => {
  const byte = new Uint8Array(1);
  globalThis.crypto.getRandomValues(byte);
  return byte[0] / 0xff;
};

const ulid = factory(secureByte);

export const generateId = (): Id => ulid() as Id;

export const isValidId = (value: unknown): value is Id =>
  typeof value === 'string' && ULID_PATTERN.test(value);

export const id = (value: string): Id => {
  if (!isValidId(value)) {
    throw new Error(`Invalid ID: ${value}`);
  }
  return value;
};
