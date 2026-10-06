import { describe, it, expect } from 'vitest';
import { namedFile, shownFileName } from './fileName';

describe('shownFileName', () => {
  it('leaves an ordinary name alone, including the letter s', () => {
    expect(shownFileName('sales statements.pdf')).toBe('sales statements.pdf');
  });

  it('puts a name that has line breaks or runs of spaces on one line', () => {
    expect(shownFileName('bill\n\n  march\t2026.pdf')).toBe('bill march 2026.pdf');
  });

  it('removes the characters that reverse the reading direction', () => {
    expect(shownFileName('invoice_‮fdp.exe')).toBe('invoice_ fdp.exe');
    expect(shownFileName('a⁦b⁩c')).toBe('a b c');
  });

  it('cuts a very long name', () => {
    expect(shownFileName('x'.repeat(500))).toHaveLength(80);
    expect(shownFileName('x'.repeat(500), 10)).toHaveLength(10);
  });

  it('gives an empty string for a name of nothing but spaces', () => {
    expect(shownFileName(' \n ')).toBe('');
  });
});

describe('namedFile', () => {
  it('keeps a name with an extension and drops a bare document number', () => {
    expect(namedFile('statement_5678.pdf')).toBe('statement_5678.pdf');
    expect(namedFile('Statement Aug.CSV')).toBe('Statement Aug.CSV');
    expect(namedFile('document:1000146636')).toBeNull();
    expect(namedFile('msf:31')).toBeNull();
  });
});
