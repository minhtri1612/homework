// The share code, as typed in the home page's box or as part of /h/CODE.
import { z } from 'zod';
import { formText } from './form.js';
import { normalizeShareCode } from '../services/share-code.service.js';

/** ?code= from the home page form: the normalised code, or a Vietnamese message. */
export const joinSchema = z.object({
  code: formText
    .refine((value) => value.trim() !== '', 'Hãy nhập mã bài tập.')
    .transform((value, ctx) => {
      const code = normalizeShareCode(value);
      if (!code) {
        ctx.issues.push({
          code: 'custom',
          input: value,
          message: 'Mã bài tập gồm 6 chữ cái và chữ số, ví dụ ABC234. Hãy kiểm tra lại.',
        });
        return z.NEVER;
      }
      return code;
    }),
});

/** :code in /h/:code → the normalised code, or null when it cannot be one. */
export const shareCodeParam = z.string().transform(normalizeShareCode);
