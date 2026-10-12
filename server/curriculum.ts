import { and, asc, eq } from "drizzle-orm";
import { curriculumOfferings, schoolSettings } from "../drizzle/schema";
import { requireDb, writeAudit } from "./smis";

export const KICD_CURRICULUM_SOURCE = "https://kicd.ac.ke/wp-content/uploads/2017/10/CURRICULUMFRAMEWORK.pdf";
export const KICD_DESIGNS_SOURCE = "https://kicd.ac.ke/cbc-materials/curriculum-designs/";
export const SCHOOL_LEVELS = ["ECDE", "Primary", "Junior School", "Senior School"] as const;
const DEFAULT_LEVELS = [...SCHOOL_LEVELS];

type Entry = { level: string; grade: string; area: string; pathway?: string };
const sharedPrimary = ["English", "Kiswahili", "Mathematics", "Environmental Activities", "Religious Education", "Creative Activities", "Movement and Creative Activities", "Indigenous Language"];
const upperPrimary = ["English", "Kiswahili", "Mathematics", "Science and Technology", "Agriculture", "Social Studies", "Religious Education", "Creative Arts", "Physical and Health Education", "Indigenous Language"];
const junior = ["English", "Kiswahili", "Mathematics", "Integrated Science", "Health Education", "Social Studies", "Business Studies", "Agriculture", "Computer Science", "Creative Arts", "Pre-Technical Studies", "Life Skills Education", "Religious Education"];
const senior: Record<string, string[]> = {
  "STEM · Pure Sciences": ["Mathematics", "English", "Kiswahili", "Biology", "Chemistry", "Physics", "General Science"],
  "STEM · Applied Sciences": ["Mathematics", "English", "Kiswahili", "Agriculture", "Computer Studies", "Business Studies", "Food and Nutrition", "Aviation"],
  "STEM · Technical Studies": ["Mathematics", "English", "Kiswahili", "Building Construction", "Electrical Installation", "Metalwork", "Power Mechanics", "Media Technology"],
  "Social Sciences · Humanities": ["English", "Kiswahili", "History and Citizenship", "Geography", "Business Studies", "Religious Education", "Community Service Learning"],
  "Social Sciences · Languages": ["English", "Kiswahili", "Arabic", "French", "German", "Mandarin", "Kenya Sign Language"],
  "Arts and Sports · Arts": ["English", "Kiswahili", "Fine Art", "Music", "Film and Theatre", "Dance", "Crafts"],
  "Arts and Sports · Sports": ["English", "Kiswahili", "Sports Science", "Physical Education", "Outdoor Pursuits"]
};

export function curriculumCatalogue(): Entry[] {
  const rows: Entry[] = [];
  for (const grade of ["PP1", "PP2"]) for (const area of ["Language Activities", "Mathematical Activities", "Environmental Activities", "Psychomotor and Creative Activities", "Religious Activities"]) rows.push({ level: "ECDE", grade, area });
  for (const grade of ["Grade 1", "Grade 2", "Grade 3"]) for (const area of sharedPrimary) rows.push({ level: "Primary", grade, area });
  for (const grade of ["Grade 4", "Grade 5", "Grade 6"]) for (const area of upperPrimary) rows.push({ level: "Primary", grade, area });
  for (const grade of ["Grade 7", "Grade 8", "Grade 9"]) for (const area of junior) rows.push({ level: "Junior School", grade, area });
  for (const grade of ["Grade 10", "Grade 11", "Grade 12"]) for (const [pathway, areas] of Object.entries(senior)) for (const area of areas) rows.push({ level: "Senior School", grade, pathway, area });
  return rows;
}

export async function getCurriculumSetup() {
  const db = await requireDb();
  const [saved, settings] = await Promise.all([db.select().from(curriculumOfferings).orderBy(asc(curriculumOfferings.level), asc(curriculumOfferings.gradeLabel), asc(curriculumOfferings.pathway), asc(curriculumOfferings.learningArea)), db.select({ enabledSchoolLevels: schoolSettings.enabledSchoolLevels }).from(schoolSettings).limit(1)]);
  const levels = settings[0]?.enabledSchoolLevels?.split(",").filter(level => SCHOOL_LEVELS.includes(level as typeof SCHOOL_LEVELS[number])) ?? DEFAULT_LEVELS;
  return { source: KICD_CURRICULUM_SOURCE, designsSource: KICD_DESIGNS_SOURCE, catalogue: curriculumCatalogue(), saved, enabledSchoolLevels: levels };
}

export async function saveEnabledSchoolLevels(levels: string[], userId: number) {
  const db = await requireDb();
  const selected = Array.from(new Set(levels.filter(level => SCHOOL_LEVELS.includes(level as typeof SCHOOL_LEVELS[number]))));
  if (!selected.length) throw new Error("SCHOOL_LEVEL_REQUIRED");
  const current = (await db.select({ id: schoolSettings.id }).from(schoolSettings).limit(1))[0];
  if (!current) throw new Error("SCHOOL_SETTINGS_REQUIRED");
  await db.update(schoolSettings).set({ enabledSchoolLevels: selected.join(",") }).where(eq(schoolSettings.id, current.id));
  await writeAudit(userId, "curriculum.school_levels.update", "school_settings", current.id, { enabledSchoolLevels: selected });
  return { enabledSchoolLevels: selected };
}

export async function saveCurriculumSelections(input: { selections: Array<{ level: string; grade: string; pathway?: string | null; area: string; offered: boolean }> }, userId: number) {
  const db = await requireDb();
  for (const row of input.selections) {
    const pathway = row.pathway || null;
    const existing = (await db.select({ id: curriculumOfferings.id }).from(curriculumOfferings).where(and(eq(curriculumOfferings.level, row.level), eq(curriculumOfferings.gradeLabel, row.grade), pathway ? eq(curriculumOfferings.pathway, pathway) : eq(curriculumOfferings.pathway, pathway as string), eq(curriculumOfferings.learningArea, row.area))).limit(1))[0];
    const values = { level: row.level, gradeLabel: row.grade, pathway, learningArea: row.area, offered: row.offered ? 1 : 0, sourceUrl: KICD_CURRICULUM_SOURCE, updatedByUserId: userId, updatedAt: new Date() };
    if (existing) await db.update(curriculumOfferings).set(values).where(eq(curriculumOfferings.id, existing.id)); else await db.insert(curriculumOfferings).values(values);
  }
  await writeAudit(userId, "curriculum.update", "curriculum_offerings", null, { count: input.selections.length });
  return { ok: true, saved: input.selections.length };
}
