// Helpers to read and write CSV files and to read prices typed by hand.
// Kept free of React and Supabase so they can be tested on their own.

/**
 * Turns the raw bytes of a CSV file into text.
 * Handles UTF-8 (with or without BOM), UTF-16 (Excel "Unicode text") and
 * falls back to Windows-1252, which is what older Excel versions save in Spanish.
 */
export function decodeCsvBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const DELIMITERS = [',', ';', '\t'] as const;

/** Picks the separator that appears most in the first line, ignoring text between quotes. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === '\n' || char === '\r')) {
      if (counts[',']! + counts[';']! + counts['\t']! > 0) break;
    } else if (!inQuotes && (DELIMITERS as readonly string[]).includes(char)) counts[char] = (counts[char] ?? 0) + 1;
  }
  let best = ',';
  for (const delimiter of DELIMITERS) {
    if ((counts[delimiter] ?? 0) > (counts[best] ?? 0)) best = delimiter;
  }
  return best;
}

/** Reads CSV text into rows of cells. Supports quotes, doubled quotes, line breaks inside quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells: string[]) => cells.some((cell: string) => cell.trim() !== ''));
}

/** Uses the first row as column names and returns one object per data row. */
export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header: string) => header.trim());
  return rows.slice(1).map((cells: string[]) => {
    const record: Record<string, string> = {};
    headers.forEach((header: string, index: number) => {
      if (header) record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

/**
 * Builds CSV text. Uses ";" by default and a BOM, so Excel with Spanish regional
 * settings opens it in separate columns and keeps the accents.
 */
export function toCsv(headers: string[], rows: (string | number)[][], delimiter = ';'): string {
  const quote = (value: string | number): string => {
    const text = String(value);
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers, ...rows].map((cells: (string | number)[]) => cells.map(quote).join(delimiter));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Reads a price in Colombian pesos typed by hand: "15000", "$ 15.000", "15,000", "15.000,50".
 * A separator followed by exactly three digits is a thousands separator (COP has no cents in practice);
 * a separator followed by one or two digits is a decimal point. The result is a whole number,
 * because the database stores prices as integers.
 */
export function parsePriceCop(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;

  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(/(?!^)-/g, '');
  if (!/\d/.test(cleaned)) return null;

  const lastSeparator = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  if (lastSeparator === -1) return parseInt(cleaned, 10);

  const afterSeparator = cleaned.slice(lastSeparator + 1);
  const beforeSeparator = cleaned.slice(0, lastSeparator).replace(/[.,]/g, '');
  if (afterSeparator.length === 3) return parseInt(`${beforeSeparator}${afterSeparator}`, 10);
  if (afterSeparator.length === 0) return beforeSeparator === '' || beforeSeparator === '-' ? null : parseInt(beforeSeparator, 10);
  return Math.round(parseFloat(`${beforeSeparator || '0'}.${afterSeparator}`));
}
