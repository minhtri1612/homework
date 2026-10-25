import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L, so a code read aloud or copied from the board is not mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function generateShareCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * What a student typed or pasted → a share code, or null if it cannot be one.
 * Accepts any letter case, spaces and dashes ("abc 234", "ABC-234") and a
 * whole link (".../h/abc234").
 */
export function normalizeShareCode(input: unknown): string | null {
  let text = String(input ?? '').normalize('NFC').trim();
  const link = text.match(/\/h\/([^/?#\s]+)/u);
  if (link) text = link[1];
  text = text.replace(/[\s-]/gu, '').toUpperCase();
  return CODE_PATTERN.test(text) ? text : null;
}
