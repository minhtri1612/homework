// Settings the deployed site cannot run without. Checked at startup, so a
// missing setting stops the deploy with a clear message instead of, say,
// quietly using a local database file that Render deletes on every restart.
import { isLocal } from './client.ts';

/** The site has no limit on guesses, so the invite code must be long. */
export const MIN_INVITE_CODE = 12;

/** Problems with the environment (Vietnamese messages); empty when it can start. */
export function productionProblems(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (!env.DATABASE_URL || isLocal(env.DATABASE_URL)) {
    problems.push('DATABASE_URL phải là địa chỉ libsql://… của Turso (file trên máy chủ Render bị xoá mỗi lần khởi động lại).');
  }
  if (!env.DATABASE_AUTH_TOKEN) problems.push('Thiếu DATABASE_AUTH_TOKEN (token của cơ sở dữ liệu Turso).');
  const invite = env.INVITE_CODE?.trim() ?? '';
  if (invite.length < MIN_INVITE_CODE) {
    problems.push(`INVITE_CODE (mã mời để đăng ký giáo viên) phải có ít nhất ${MIN_INVITE_CODE} ký tự.`);
  }
  return problems;
}
