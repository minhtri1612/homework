// Shape and coercion of the homework editor form. Nothing here decides
// whether a homework is valid: validateHomework() in the homework service
// does that on every save, with the same messages as the editor preview.
import { z } from 'zod';
import { formLine, formText } from './form.ts';
import { fromVietnamInput } from '../vietnam-time.ts';

/** Anything that is not a plain object is read as {}, so its fields become defaults. */
function objectOrEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}), schema);
}

const isTrue = z.unknown().optional().transform((value) => value === true);

/** "" → null (no limit), digits → that number, anything else → NaN, which validateHomework() reports. */
function minutes(text: string): number | null {
  const value = text.trim();
  if (value === '') return null;
  return /^\d{1,6}$/.test(value) ? Number(value) : Number.NaN;
}

/** "" → null ("Chưa xếp lớp"), digits → that number, anything else → NaN, which validateHomework() reports. */
function gradeValue(text: string): number | null {
  const value = text.trim();
  if (value === '') return null;
  return /^\d{1,2}$/.test(value) ? Number(value) : Number.NaN;
}

const answer = objectOrEmpty(z.object({ text: formText, correct: isTrue }));

const question = objectOrEmpty(
  z.object({
    text: formText,
    shuffleAnswers: isTrue,
    answers: z.unknown().optional().transform((value) => (Array.isArray(value) ? value : [])).pipe(z.array(answer)),
  }),
);

/**
 * The editor form. The cards arrive as JSON in the hidden "questions" field;
 * anything unexpected in it is coerced to the right shape so that validation,
 * not a crash, reports what is wrong. This schema never fails: unreadable JSON
 * gives unreadable: true and no questions.
 */
export const editorSchema = z
  .object({
    title: formLine,
    revealMode: z.unknown().optional().transform((value) => String(value ?? 'after_submit')),
    deadline: formText,
    shuffleQuestions: z.unknown().optional().transform((value) => value === '1'),
    timeLimit: formText,
    grade: formText,
    questions: z
      .unknown()
      .optional()
      .transform((value) => {
        try {
          return JSON.parse(String(value ?? '[]'));
        } catch {
          return null;
        }
      })
      .pipe(z.union([z.null(), z.array(question), z.unknown().transform(() => [])])),
  })
  .transform(({ deadline, timeLimit, grade, questions, ...form }) => ({
    ...form,
    deadline: fromVietnamInput(deadline),
    deadlineInput: deadline,
    timeLimitMinutes: minutes(timeLimit),
    timeLimitInput: timeLimit,
    grade: gradeValue(grade),
    gradeInput: grade,
    questions: questions ?? [],
    unreadable: questions === null,
  }));

/** The dashboard's "Chuyển đến" form: the grade it moves the homework to. */
export const moveSchema = z.object({ grade: formText }).transform(({ grade }) => ({ grade: gradeValue(grade) }));

/** The :id in /teacher/homeworks/:id; null when it cannot be a homework id. */
export const homeworkIdParam = z
  .string()
  .transform((value) => (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null));

export type EditorForm = z.infer<typeof editorSchema>;
