/**
 * Formats a calendar date using the device's local timezone.
 * Business date fields must not use `toISOString()`, which formats in UTC.
 */
export function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayLocalDate(): string {
  return formatLocalDate();
}

/** Adds calendar days in the device's local timezone. */
export function addLocalDays(days: number, date: Date = new Date()): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return formatLocalDate(result);
}