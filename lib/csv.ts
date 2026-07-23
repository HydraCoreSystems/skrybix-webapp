// RFC-4180 style field escaping — the Sheets version joined rows with a
// plain "," and no quoting, which silently corrupted exports the moment a
// plant name contained a comma (common in botanical naming). Never
// regress to a plain join(",") here.
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(",");
}

export function buildCsv(header: string[], rows: unknown[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\r\n");
}
