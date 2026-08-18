export const LABELS_PER_SHEET = 30;

// Adaptive font-size tier for a single line of label text (genus/species on
// line 1, cultivar on line 2), keyed to character count.
//
// The physical constraint: a .label-cell is 2.25in wide (see --label-width
// in app/globals.css). Cutting labels are the tighter case -- they carry
// BOTH the GM logo (0.52in) and the QR code (0.52in) alongside the text,
// vs. mother labels which only carry the QR (0.6in) -- so the available
// text width on a cutting label is roughly:
//   2.25in - 0.07in padding - 0.52in logo - 0.52in QR - 0.08in gaps ≈ 1.06in
// These tiers are sized against that tighter budget so one shared scale is
// safe on both label types (mother labels end up with a little extra
// headroom, which is fine).
//
// A system sans-serif averages roughly 0.5em per character. At font-size
// X (pt), that's about (0.5 * X / 72)in per character, so a line of N
// characters needs roughly (0.5 * X * N / 72)in of width. These tiers keep
// that comfortably under ~1.06in for their bucket, WITHOUT forcing a long
// name onto one crushed line -- overflow-wrap on .label-cell .text already
// lets a line that doesn't fit wrap onto a second sub-line instead, and the
// vertical budget (0.75in cell height, ~0.68in after padding) has enough
// slack for that even in the tiers below (verified: id line + two
// worst-case double-wrapped "xs" lines still fits with margin to spare).
//
// Never a smaller floor than the previous flat 7pt except for the genuine
// long tail (> 26 chars), where relying on wrap instead of shrinking
// further would start crowding the ID line and QR/logo vertically.
export type LineSizeClass = "lg" | "md" | "sm" | "xs";

export function sizeClassForLine(text: string | null | undefined): LineSizeClass {
  const len = (text ?? "").length;
  if (len <= 12) return "lg";
  if (len <= 18) return "md";
  if (len <= 26) return "sm";
  return "xs";
}

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
