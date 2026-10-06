import { getRandomValues } from 'expo-crypto';

/**
 * Hermes has no Web Crypto. Anything that needs secure random numbers (ids,
 * backup encryption) calls crypto.getRandomValues, so supply it from
 * Android's secure generator before any other module runs.
 */
const scope = globalThis as { crypto?: Partial<Crypto> };
if (typeof scope.crypto?.getRandomValues !== 'function') {
  scope.crypto = { ...(scope.crypto ?? {}), getRandomValues } as Partial<Crypto>;
}
