// Query and form fields of the teacher's results pages.
import { z } from 'zod';
import { formText } from './form.ts';

const ID = /^[1-9]\d{0,15}$/;

/** ?version=N: a version number, null when absent; NaN marks one that cannot exist (→ 404). */
export const versionQuery = z.object({
  version: formText.transform((value) => (value === '' ? null : ID.test(value) ? Number(value) : Number.NaN)),
});

/** :submissionId in the address; null when it cannot be an id. */
export const submissionIdParam = z.string().transform((value) => (ID.test(value) ? Number(value) : null));

/** The delete confirmation: the box "I understand the submissions are deleted" must be ticked when there are some. */
export const deleteHomeworkForm = z.object({ confirm: z.unknown().optional().transform((value) => value === '1') });
