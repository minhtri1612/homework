// Teachers type times in Vietnam time, which is always UTC+7 (no daylight
// saving). The database stores UTC. These convert between the two for
// <input type="datetime-local">, whose value looks like "2026-11-01T17:00".

const INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const OFFSET_MS = 7 * 60 * 60 * 1000;

// new Date(INVALID_TIME) is an Invalid Date.
export const INVALID_TIME = 'invalid';

/**
 * "2026-11-01T17:00" → "2026-11-01T10:00:00.000Z"; '' → null.
 * Anything else gives INVALID_TIME, which validation reports as invalid.
 */
export function fromVietnamInput(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!INPUT.test(text)) return INVALID_TIME;
  const date = new Date(`${text}:00+07:00`);
  // "2026-02-30T10:00" would quietly become 2 March; converting back catches it.
  if (Number.isNaN(date.getTime()) || toVietnamInput(date.toISOString()) !== text) return INVALID_TIME;
  return date.toISOString();
}

/** "2026-11-01T10:00:00.000Z" → "2026-11-01T17:00"; null → ''. */
export function toVietnamInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

const DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "2026-11-01T10:00:00.000Z" → "01/11/2026". */
export function formatVietnamDate(iso: string): string {
  return DATE.format(new Date(iso));
}

/** "2026-11-01T10:00:00.000Z" → "17:00 01/11/2026". */
export function formatVietnamDateTime(iso: string): string {
  return `${TIME.format(new Date(iso))} ${formatVietnamDate(iso)}`;
}
