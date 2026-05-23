/**
 * Formats a `Date` in Ethiopia time (GMT+3, no DST) using a 12-hour clock with
 * an AM/PM marker. Returns a string of the form:
 *
 *   "May 23, 2026 · 06:31:08 AM (GMT+3)"
 *
 * The locale is fixed to `en-US` so the month name, AM/PM marker, and ordering
 * are stable across hosts regardless of the server's locale environment.
 */
export function formatGmtPlus3(value: Date | string | null | undefined): string {
  if (value == null) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';

  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Etc/GMT-3', // POSIX sign-flip: "GMT-3" zone == UTC+3 offset
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Etc/GMT-3',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);

  return `${dateParts} · ${timeParts} (GMT+3)`;
}
