import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export type PickedStatement =
  | { kind: 'csv'; text: string; fileName: string }
  | { kind: 'pdf'; uri: string; fileName: string };

/**
 * Opens the system file picker for a statement. A CSV is read here; a PDF is
 * handed back by location, because reading one takes the native extractor
 * and possibly a password. Returns null when the user backs out.
 */
export const pickStatement = async (): Promise<PickedStatement | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    // JSON is a Paisa backup; octet-stream is how some file managers label it.
    type: ['text/csv', 'text/comma-separated-values', 'application/pdf', 'application/json', 'application/octet-stream'],
    // Read where it is: a copy of a bank statement left in the app's cache would outlive the import.
    copyToCacheDirectory: false,
  });

  const file = result.canceled ? undefined : result.assets[0];
  if (!file) return null;

  // The picker's name is the one the phone shows. The file's address is often only a document
  // number ("document:1000146636") with no name or extension in it, so it decides nothing.
  if (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return { kind: 'pdf', uri: file.uri, fileName: file.name };
  }
  return { kind: 'csv', text: await new File(file.uri).text(), fileName: file.name };
};
