// The grade and section in /lop/:grade/:section. Only the exact spellings in
// src/catalog.ts are accepted ("12", "bai-tap"); anything else becomes null (404).
import { z } from 'zod';
import { GRADES, SECTIONS } from '../catalog.ts';

export const gradeParam = z.string().transform((value) => GRADES.find((grade) => String(grade) === value) ?? null);

export const sectionParam = z.string().transform((value) => SECTIONS.find((section) => section.slug === value) ?? null);
