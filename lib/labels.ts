export const LABELS_PER_SHEET = 30;

export function parseStartPosition(raw: string | undefined): number {
  const n = parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(LABELS_PER_SHEET, Math.max(1, n));
}
