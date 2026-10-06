import type { DocSection, ReportDoc } from './doc';

/** Text made safe to place in HTML: every name in a report came from a bank or a person. */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f1ed; color: #1b1b1a; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .page { max-width: 780px; margin: 0 auto; background: #ffffff; min-height: 100vh; }
  header { background: #161615; color: #f5f5f2; padding: 28px 32px 22px; }
  header .brand { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #a8a8a2; }
  header h1 { margin: 6px 0 4px; font-size: 26px; }
  header p { margin: 0; color: #cfcfc9; }
  main { padding: 8px 32px 24px; }
  h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #6b6b66; margin: 26px 0 10px; }
  .figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .figure { border: 1px solid #e4e3de; border-radius: 10px; padding: 12px 14px; }
  .figure .label { font-size: 12px; color: #6b6b66; }
  .figure .value { font-size: 19px; font-weight: 650; margin-top: 2px; }
  .figure .note { font-size: 12px; color: #6b6b66; margin-top: 2px; }
  .in { color: #12805c; } .out { color: #c4321f; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #ecebe6; vertical-align: top; }
  th { font-size: 12px; color: #6b6b66; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty { color: #6b6b66; }
  .callout { background: #eaf3fb; border: 1px solid #cfe2f3; border-radius: 10px; padding: 12px 16px; }
  .callout p { margin: 4px 0; }
  footer { padding: 14px 32px 28px; color: #6b6b66; font-size: 12px; border-top: 1px solid #ecebe6; }
  @media print {
    body { background: #ffffff; }
    .page { max-width: none; min-height: 0; }
    header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr, .figure, .callout { break-inside: avoid; }
  }
`;

const section = (s: DocSection): string => {
  const title = `<h2>${escapeHtml(s.title)}</h2>`;
  switch (s.kind) {
    case 'figures':
      return `${title}<div class="figures">${s.figures
        .map(
          (f) =>
            `<div class="figure"><div class="label">${escapeHtml(f.label)}</div>` +
            `<div class="value${f.tone ? ` ${f.tone}` : ''}">${escapeHtml(f.value)}</div>` +
            (f.note ? `<div class="note">${escapeHtml(f.note)}</div>` : '') +
            `</div>`
        )
        .join('')}</div>`;
    case 'table': {
      if (s.rows.length === 0) return `${title}<p class="empty">${escapeHtml(s.empty)}</p>`;
      const cls = (i: number) => (s.numeric[i] ? ' class="num"' : '');
      const head = s.columns.map((c, i) => `<th${cls(i)}>${escapeHtml(c)}</th>`).join('');
      const body = s.rows
        .map((row) => `<tr>${row.map((cell, i) => `<td${cls(i)}>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('');
      return `${title}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case 'callout':
      return `${title}<div class="callout">${s.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}</div>`;
  }
};

/**
 * The report as one self-contained HTML page: no scripts, no fonts or images fetched, so it
 * opens the same anywhere, and a browser's Print turns it into a PDF.
 */
export const reportHtml = (doc: ReportDoc, madeOn: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(`${doc.title} · ${doc.subtitle}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<header><div class="brand">Hisaab</div><h1>${escapeHtml(doc.title)}</h1><p>${escapeHtml(doc.subtitle)}</p></header>
<main>${doc.sections.map(section).join('\n')}</main>
<footer><p>${escapeHtml(doc.footnote)}</p><p>Made by Hisaab on ${escapeHtml(madeOn)}. This file is not encrypted.</p></footer>
</div>
</body>
</html>
`;
