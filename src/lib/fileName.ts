/**
 * A file name that another app chose, made safe to show in a confirmation dialog: one line,
 * no control characters, and none of the characters that flip the reading direction (which
 * can make "invoice_fdp.exe" display as "invoice_exe.pdf"), cut to `max` characters.
 */
export function shownFileName(name: string, max = 80): string {
  return name
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * The name of a picked file worth showing, or null when what was kept is only the picker's
 * document number ("document:1000146636"): a real name ends in an extension.
 */
export function namedFile(name: string): string | null {
  const shown = shownFileName(name);
  return /\.[a-z0-9]{2,5}$/i.test(shown) ? shown : null;
}
