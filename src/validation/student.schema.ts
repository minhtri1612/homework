// The student's name and the answer form.
import { z } from 'zod';
import { formLine, formText } from './form.ts';

export const MAX_NAME = 100;

const studentName = formLine.pipe(
  z.string().min(1, 'Hãy nhập họ tên.').max(MAX_NAME, `Họ tên dài quá (tối đa ${MAX_NAME} ký tự).`),
);

/** ?name= on /h/CODE/answer. */
export const nameSchema = z.object({ name: studentName });

const ID = /^[1-9]\d{0,15}$/;
const id = formText.refine((value) => ID.test(value)).transform(Number);

/**
 * The answer form: hidden name, versionId and questionIds ("12,13,14"), and one
 * radio group per question named q<questionId> whose value is the answer id.
 * A question without a choice was left blank. Anything else that is not an id
 * makes the whole form invalid (only a hand-made request does that).
 */
export const submitSchema = z
  .looseObject({
    name: studentName,
    versionId: id,
    questionIds: formText
      .refine((value) => value.split(',').every((part) => ID.test(part)))
      .transform((value) => value.split(',').map(Number)),
  })
  .transform((body, ctx) => {
    const choices = new Map<number, number | null>();
    for (const questionId of body.questionIds) {
      const value = String(body[`q${questionId}`] ?? '');
      if (value === '') choices.set(questionId, null);
      else if (ID.test(value)) choices.set(questionId, Number(value));
      else {
        ctx.issues.push({ code: 'custom', input: value, path: [`q${questionId}`], message: 'Dữ liệu bài làm không hợp lệ.' });
        return z.NEVER;
      }
    }
    return { name: body.name, versionId: body.versionId, questionIds: body.questionIds, choices };
  });

export type SubmitForm = z.infer<typeof submitSchema>;

/**
 * What the answer page sends (navigator.sendBeacon) when the student leaves
 * it, and when they come back with the seconds they were away.
 */
export const awaySchema = z.object({
  name: studentName,
  event: z.enum(['leave', 'back']),
  seconds: formText.pipe(z.string().regex(/^\d{1,7}$/)).transform(Number).optional(),
}).transform(({ seconds, ...rest }) => ({ ...rest, seconds: seconds ?? 0 }));
