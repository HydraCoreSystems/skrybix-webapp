// Case-insensitive substring match across whichever fields a list page
// wants searchable. Filters an already-fetched array in the Server
// Component rather than building an .ilike/.or() query string -- these
// tables are small (hundreds of rows, per CLAUDE.md's real migration
// counts), so an in-memory filter is simpler and avoids escaping user
// input into a comma-delimited PostgREST filter string.
export function matchesQuery(fields: (string | null | undefined)[], q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return fields.some((f) => f && String(f).toLowerCase().includes(needle));
}
