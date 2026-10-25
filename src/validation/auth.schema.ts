// Shape and coercion of the register and login forms. These schemas never
// touch the database: "email already registered" is checked by the controller,
// so validation cannot reveal which emails exist.
import { z } from 'zod';
import { formLine, formText } from './form.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MIN_PASSWORD = 8;

const email = formText.transform((value) => value.trim().toLowerCase());

/** The register form cleaned up but not checked: what is shown again after an error. */
export const registerForm = z.object({
  name: formLine,
  email,
  password: formText,
  confirm: formText,
  // Checked against INVITE_CODE by the controller (only when one is set).
  invite: formText.transform((value) => value.trim()),
});

export const registerSchema = registerForm
  .pipe(
    z.object({
      name: z.string().min(1, 'Hãy nhập họ tên.').max(100, 'Họ tên dài quá (tối đa 100 ký tự).'),
      email: z.string().regex(EMAIL, 'Email không hợp lệ.').max(254, 'Email không hợp lệ.'),
      password: z
        .string()
        .min(MIN_PASSWORD, `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`)
        .max(200, 'Mật khẩu dài quá (tối đa 200 ký tự).'),
      confirm: z.string(),
      invite: z.string(),
    }),
  )
  .refine((form) => form.password === form.confirm, {
    path: ['confirm'],
    message: 'Hai mật khẩu không giống nhau.',
    // Also when another field has an error, so every problem shows at once;
    // but not when the password itself is wrong.
    when: (payload) => !payload.issues.some((issue) => issue.path?.[0] === 'password'),
  });

export const loginSchema = z.object({ email, password: formText });

export type RegisterForm = z.infer<typeof registerSchema>;
export type LoginForm = z.infer<typeof loginSchema>;
