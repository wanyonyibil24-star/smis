import { and, eq } from "drizzle-orm";
import { schoolSettings, staffClockings, staffProfiles } from "../drizzle/schema";
import { getDb } from "./db";
import { userCan, writeAudit } from "./smis";

async function requireDb() { const db = await getDb(); if (!db) throw new Error("DATABASE_UNAVAILABLE"); return db; }
const today = () => new Date().toISOString().slice(0, 10);
const distance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const radians = (v: number) => v * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

async function assertManager(userId: number, authRole: string) {
  const db = await requireDb();
  const profile = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  if (authRole !== "admin" && !["super_admin", "admin", "head_teacher", "deputy_head"].includes(profile?.role ?? "")) throw new Error("SCHOOL_LOCATION_ADMIN_ONLY");
  if (!await userCan(userId, authRole, "settings.edit")) throw new Error("SCHOOL_LOCATION_PERMISSION_REQUIRED");
}

export async function getClockingSetup(userId: number) {
  const db = await requireDb();
  const settings = (await db.select({ latitude: schoolSettings.latitude, longitude: schoolSettings.longitude, radius: schoolSettings.geofenceRadiusMeters }).from(schoolSettings).limit(1))[0];
  const existing = (await db.select().from(staffClockings).where(and(eq(staffClockings.userId, userId), eq(staffClockings.clockDate, new Date(`${today()}T00:00:00Z`)))).limit(1))[0];
  return { configured: settings?.latitude != null && settings.longitude != null, latitude: settings?.latitude ?? null, longitude: settings?.longitude ?? null, radiusMeters: settings?.radius ?? 150, clockedIn: !!existing, clocking: existing ?? null, date: today() };
}

export async function saveSchoolLocation(input: { latitude: number; longitude: number; radiusMeters: number }, userId: number, authRole: string) {
  await assertManager(userId, authRole);
  const db = await requireDb();
  const current = (await db.select({ id: schoolSettings.id }).from(schoolSettings).limit(1))[0];
  if (current) await db.update(schoolSettings).set({ latitude: input.latitude.toFixed(7), longitude: input.longitude.toFixed(7), geofenceRadiusMeters: input.radiusMeters }).where(eq(schoolSettings.id, current.id));
  else await db.insert(schoolSettings).values({ schoolName: "Ebunangwe Junior School", currentTerm: "Term 2", academicYear: new Date().getUTCFullYear(), latitude: input.latitude.toFixed(7), longitude: input.longitude.toFixed(7), geofenceRadiusMeters: input.radiusMeters });
  await writeAudit(userId, "settings.school_location.update", "school_settings", current?.id ?? null, input);
  return getClockingSetup(userId);
}

export async function clockIn(input: { latitude: number; longitude: number }, userId: number) {
  const db = await requireDb();
  const settings = (await db.select({ latitude: schoolSettings.latitude, longitude: schoolSettings.longitude, radius: schoolSettings.geofenceRadiusMeters }).from(schoolSettings).limit(1))[0];
  if (!settings?.latitude || !settings.longitude) throw new Error("SCHOOL_LOCATION_NOT_CONFIGURED");
  const existing = (await db.select().from(staffClockings).where(and(eq(staffClockings.userId, userId), eq(staffClockings.clockDate, new Date(`${today()}T00:00:00Z`)))).limit(1))[0];
  if (existing) return { ok: true, alreadyClockedIn: true, distanceMeters: Number(existing.distanceMeters), clocking: existing };
  const meters = distance(input.latitude, input.longitude, Number(settings.latitude), Number(settings.longitude));
  if (meters > Number(settings.radius ?? 150)) throw new Error(`OUTSIDE_SCHOOL_GEOFENCE:${Math.round(meters)}:${settings.radius ?? 150}`);
  const inserted = (await db.insert(staffClockings).values({ userId, clockDate: new Date(`${today()}T00:00:00Z`), latitude: input.latitude.toFixed(7), longitude: input.longitude.toFixed(7), distanceMeters: meters.toFixed(2) }).$returningId())[0];
  await writeAudit(userId, "staff.clock_in", "staff_clocking", inserted.id, { date: today(), distanceMeters: Math.round(meters) });
  return { ok: true, alreadyClockedIn: false, distanceMeters: Math.round(meters), clocking: (await db.select().from(staffClockings).where(eq(staffClockings.id, inserted.id)).limit(1))[0] };
}
