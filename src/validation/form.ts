// Helpers shared by the schemas. Forms send strings, but a crafted request can
// send anything (a missing field, or an array for a repeated field), so every
// field is first turned into a string the way the code always did: String(value ?? '').
import { z } from 'zod';

// .optional() so that a field missing from the request becomes '' instead of an error.
export const formText = z.unknown().optional().transform((value) => String(value ?? ''));

/** NFC, runs of whitespace collapsed to one space, trimmed: names and titles. */
export const formLine = formText.transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim());

/**
 * The first message for each field, as { field: message }, so a page shows
 * one problem per field in the order the schema checks them.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !(field in errors)) errors[field] = issue.message;
  }
  return errors;
}
