import { Directory, File } from 'expo-file-system';
import { getRandomBytes } from 'expo-crypto';
import { isoDate } from '@/lib/date';
import type { RandomSource } from '@/security/encryption';

/**
 * The device side of backups: where randomness comes from and where files
 * go. Kept apart from the store so the store stays testable in Node.
 */

/** Android's secure random generator, through expo-crypto. */
export const secureRandom: RandomSource = (length) => getRandomBytes(length);

/**
 * Asks the user for a folder (Drive, Downloads, a USB stick — whatever the
 * system picker offers) and writes the backup there. Returns the file name,
 * or null when they back out.
 */
export const saveBackupFile = (contents: string): Promise<string | null> =>
  saveTextFile(contents, `hisaab-backup-${isoDate(new Date())}.json`, 'application/json');

/** Asks the user for a folder and writes a text file there; the file name, or null when they back out. */
export const saveTextFile = async (contents: string, name: string, mimeType: string): Promise<string | null> => {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return null;
  }
  const file = folder.createFile(name, mimeType);
  file.write(contents);
  return file.name ?? name;
};

/** Opens the system picker for a backup file; null when the user backs out. */
export const pickBackupFile = async (): Promise<string | null> => {
  const picked = await File.pickFileAsync({
    mimeTypes: ['application/json', 'application/octet-stream', 'text/plain'],
  });
  if (picked.canceled) return null;
  return picked.result.text();
};
