import { describe, it, expect } from 'vitest';
import { utf8Encode, utf8Decode, toBase64, fromBase64 } from './bytes';

describe('utf8', () => {
  it.each([
    ['plain ASCII', 'SWIGGY ORDER 4451'],
    ['the rupee sign', '₹ 1,250.00'],
    ['Devanagari', 'पनीर और छाछ'],
    ['an emoji outside the basic plane', 'paid 🍞🥛'],
    ['nothing', ''],
  ])('round-trips %s', (_, text) => {
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('matches the platform encoder byte for byte', () => {
    const text = 'Rs ₹ पनीर 🍞 "quoted" \n new line';
    expect([...utf8Encode(text)]).toEqual([...new TextEncoder().encode(text)]);
  });

  it('decodes text large enough to overflow a single fromCharCode call', () => {
    const text = 'पनीर '.repeat(50_000);
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('replaces malformed bytes instead of throwing', () => {
    expect(utf8Decode(Uint8Array.from([0x41, 0xff, 0x42]))).toBe('A�B');
    // An overlong encoding of "/" must not decode to "/".
    expect(utf8Decode(Uint8Array.from([0xe0, 0x80, 0xaf]))).not.toContain('/');
  });
});

describe('base64', () => {
  it.each([0, 1, 2, 3, 4, 5, 31, 32, 33])('round-trips %i bytes', (length) => {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('matches the standard encoding', () => {
    const bytes = utf8Encode('Money OS ₹');
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('refuses text that is not base64', () => {
    expect(fromBase64('abc')).toBeNull();
    expect(fromBase64('ab$=')).toBeNull();
    expect(fromBase64('a=bc')).toBeNull();
  });
});
