export function routeRecordId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
