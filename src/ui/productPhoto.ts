import { Directory, File, Paths } from 'expo-file-system';
import { generateId } from '@/lib/ulid';
import { photoProblem, photoExtension } from '@/lib/photoRules';
import { takePhoto } from '../../modules/intake';

/**
 * The device side of product photos, kept out of the store so the store stays testable in
 * Node. A photo is chosen with the system picker and copied into the app's own private
 * folder under a name the app makes up, so nothing about where it came from or what it
 * was called is kept, and it does not disappear if the original is deleted.
 */

const folder = (): Directory => new Directory(Paths.document, 'product-photos');

export type PhotoPick = { uri: string } | { error: string } | null;

/** Where a photo comes from: the phone's camera, or a file chosen with the system picker. */
export type PhotoSource = 'camera' | 'files';

/**
 * Copies a photo into the app's own folder under a made-up name. The copy is awaited: it runs
 * off the JavaScript thread, and the file it reads must still be there when it does.
 */
const keep = async (source: File, extension: string | undefined): Promise<PhotoPick> => {
  const problem = photoProblem(extension, source.size ?? undefined);
  if (problem) return { error: problem };

  const target = folder();
  target.create({ intermediates: true, idempotent: true });
  const copy = new File(target, `${generateId()}${extension}`);
  await source.copy(copy);
  return { uri: copy.uri };
};

/** Opens the camera or the picker for an image; null when the user backs out. */
export const pickProductPhoto = async (from: PhotoSource = 'files'): Promise<PhotoPick> => {
  if (from === 'camera') {
    let shot: string | null;
    try {
      shot = await takePhoto();
    } catch {
      return { error: 'Could not open the camera. Use Choose to pick a photo instead' };
    }
    if (!shot) return null;

    // The camera left its picture in the app's cache: keep a copy, and never leave the original.
    const original = new File(shot);
    try {
      return await keep(original, '.jpg');
    } catch {
      return { error: 'Could not save that photo. Try again' };
    } finally {
      try {
        original.delete();
      } catch {
        // Cache is cleared by the system in time.
      }
    }
  }

  try {
    const picked = await File.pickFileAsync({ mimeTypes: ['image/*'] });
    if (picked.canceled) return null;
    const source = picked.result;
    // The system picker hands back an address with no extension in it: go by the reported type.
    return await keep(source, photoExtension(source.type, source.name) ?? photoExtension(null, source.extension));
  } catch {
    return { error: 'Could not read that photo. Try another one' };
  }
};

/** Deletes a photo the app made, when it is replaced or dropped. Anything else is left alone. */
export const discardProductPhoto = (uri: string | undefined): void => {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists && file.parentDirectory.uri === folder().uri) file.delete();
  } catch {
    // A photo that cannot be removed is only wasted space.
  }
};

/** "Delete all data" takes the photos with it. */
export const discardAllProductPhotos = (): void => {
  try {
    const target = folder();
    if (target.exists) target.delete();
  } catch {
    // Nothing to remove, or it could not be removed; either way the ledger is already empty.
  }
};
