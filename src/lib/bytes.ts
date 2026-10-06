/**
 * Text and base64 conversions written out by hand, because Hermes does not
 * promise TextDecoder or atob/btoa on every React Native version. Both run
 * over whole backups, so they build arrays rather than concatenating strings.
 */

export const utf8Encode = (text: string): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);

    // A surrogate pair is one character outside the basic plane (an emoji,
    // say); a lone surrogate is malformed and becomes U+FFFD.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
};

/** Decodes UTF-8 that this app wrote; malformed sequences become U+FFFD. */
export const utf8Decode = (bytes: Uint8Array): string => {
  const units: number[] = [];
  const chunks: string[] = [];
  const flush = () => {
    chunks.push(String.fromCharCode(...units));
    units.length = 0;
  };

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let code = 0xfffd;
    let size = 1;

    const cont = (k: number) => ((bytes[i + k] ?? 0) & 0xc0) === 0x80;
    if (b < 0x80) {
      code = b;
    } else if (b >= 0xc2 && b < 0xe0 && cont(1)) {
      code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      size = 2;
    } else if (b >= 0xe0 && b < 0xf0 && cont(1) && cont(2)) {
      code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      size = 3;
    } else if (b >= 0xf0 && b < 0xf5 && cont(1) && cont(2) && cont(3)) {
      code =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      size = 4;
    }
    // Overlong forms and encoded surrogates are malformed, not characters.
    const malformed =
      (size === 3 && (code < 0x800 || (code >= 0xd800 && code <= 0xdfff))) ||
      (size === 4 && (code < 0x10000 || code > 0x10ffff));
    if (malformed) {
      code = 0xfffd;
      size = 1;
    }
    i += size;

    if (code >= 0x10000) {
      const shifted = code - 0x10000;
      units.push(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
    } else {
      units.push(code);
    }
    // String.fromCharCode takes its units as arguments, so keep each call
    // well under engine argument limits.
    if (units.length >= 8192) flush();
  }
  flush();
  return chunks.join('');
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

export const toBase64 = (bytes: Uint8Array): string => {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out.push(ALPHABET[a >> 2]);
    out.push(ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)]);
    out.push(b === undefined ? '=' : ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)]);
    out.push(c === undefined ? '=' : ALPHABET[c & 0x3f]);
  }
  return out.join('');
};

/** Returns null for anything that is not canonical base64. */
export const fromBase64 = (text: string): Uint8Array | null => {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) return null;

  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);

  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const quad = [0, 1, 2, 3].map((k) => {
      const ch = clean[i + k];
      if (ch === '=' && i + 4 === clean.length && k >= 4 - padding) return 0;
      return LOOKUP.get(ch) ?? -1;
    });
    if (quad.some((v) => v < 0)) return null;

    const n = (quad[0] << 18) | (quad[1] << 12) | (quad[2] << 6) | quad[3];
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
};
