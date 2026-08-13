export const LABELS_PER_SHEET = 30;

export function parseStartPosition(raw: string | undefined): number {
  const n = parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(LABELS_PER_SHEET, Math.max(1, n));
}

export type LabelSheetChunk<T> = { blanks: number; items: T[] };

// Splits a queue of items across one or more physical sheets. Only the
// FIRST sheet gets leading blank cells (the partial sheet already in the
// printer, per the start position picker) -- every sheet after that is a
// fresh full blank sheet, so it must start at position 1 with zero
// blanks. Each returned chunk becomes its own .label-sheet grid in the
// page, which re-applies the real physical top/left margin per sheet
// (critical: without this, a run that overflows past 30 labels would
// print its second sheet flush against the page edge instead of aligned
// to the blank Avery sheet's actual label positions).
export function chunkIntoSheets<T>(items: T[], start: number): LabelSheetChunk<T>[] {
  const sheets: LabelSheetChunk<T>[] = [];
  const remaining = items.slice();
  let blanks = Math.min(start - 1, LABELS_PER_SHEET - 1);

  while (remaining.length > 0) {
    const capacity = LABELS_PER_SHEET - blanks;
    sheets.push({ blanks, items: remaining.splice(0, capacity) });
    blanks = 0;
  }

  return sheets;
}
