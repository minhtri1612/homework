// How the site is organised: grades, and the sections inside each grade.
// The only place this structure is written down; pages and routes read it from here.

export const GRADES = [6, 7, 8, 9, 10, 11, 12] as const;

export type Grade = (typeof GRADES)[number];

/**
 * Sections of a grade, in display order. kind 'homework' lists the homeworks of
 * that grade; 'coming-soon' shows the "being written" notice. To fill in a
 * section later, give it a new kind and a page for it.
 */
export const SECTIONS = [
  { slug: 'tu-vung', name: 'Từ vựng', kind: 'coming-soon' },
  { slug: 'ngu-phap', name: 'Ngữ pháp', kind: 'coming-soon' },
  { slug: 'bai-tap', name: 'Bài tập', kind: 'homework' },
] as const;

export type Section = (typeof SECTIONS)[number];

export function isGrade(value: unknown): value is Grade {
  return GRADES.includes(value as Grade);
}

export function gradeName(grade: Grade): string {
  return `Lớp ${grade}`;
}
