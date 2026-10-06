/** Photos a product may have: kinds the phone can always show, and a size that cannot fill it. */
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

const TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/**
 * The extension to keep a photo under, from what the phone says it is: its type first (a file
 * picked through the system picker has an address with no extension in it), then its name
 * only when the phone reports no useful type. A type that says it is something else (a
 * document, a package) is refused whatever the file is called. Undefined when it is not one
 * of the kinds kept.
 */
export const photoExtension = (mimeType: string | null | undefined, name: string | null | undefined): string | undefined => {
  const type = (mimeType ?? '').toLowerCase();
  if (TYPES[type]) return TYPES[type];
  if (type !== '' && type !== 'application/octet-stream') return undefined;
  const text = name ?? '';
  const dot = text.lastIndexOf('.');
  const byName = dot >= 0 ? text.slice(dot).toLowerCase() : '';
  if (!PHOTO_EXTENSIONS.includes(byName)) return undefined;
  return byName === '.jpeg' ? '.jpg' : byName;
};

/** Why a picked file cannot be used as a product photo, or undefined when it can. */
export const photoProblem = (extension: string | undefined, bytes?: number): string | undefined => {
  if (!extension || !PHOTO_EXTENSIONS.includes(extension.toLowerCase())) return 'Choose a JPG, PNG or WebP photo';
  if (bytes !== undefined && bytes > MAX_PHOTO_BYTES) return 'That photo is too large. Choose one under 20 MB';
  return undefined;
};
