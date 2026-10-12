import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { libraryBooks, libraryCategories, libraryCopies, libraryFines, libraryLoans, learners, staffProfiles, users } from "../drizzle/schema";
import { getDb } from "./db";
import { writeAudit } from "./smis";

async function requireDb() { const db = await getDb(); if (!db) throw new Error("DATABASE_UNAVAILABLE"); return db; }
const dateOnly = (offset = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(0, 0, 0, 0); return d; };

export async function libraryOverview() {
  const db = await requireDb();
  const [books, copies, available, borrowed, overdue, members, fines] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(libraryBooks).where(isNull(libraryBooks.deletedAt)),
    db.select({ count: sql<number>`count(*)` }).from(libraryCopies),
    db.select({ count: sql<number>`count(*)` }).from(libraryCopies).where(eq(libraryCopies.status, "available")),
    db.select({ count: sql<number>`count(*)` }).from(libraryCopies).where(eq(libraryCopies.status, "borrowed")),
    db.select({ count: sql<number>`count(*)` }).from(libraryLoans).where(and(isNull(libraryLoans.returnedOn), lt(libraryLoans.dueDate, dateOnly()))),
    db.select({ learners: sql<number>`count(*)` }).from(learners).where(eq(learners.status, "active")),
    db.select({ amount: sql<string>`coalesce(sum(${libraryFines.amount} - ${libraryFines.paid}), 0)` }).from(libraryFines),
  ]);
  return { titles: Number(books[0]?.count ?? 0), copies: Number(copies[0]?.count ?? 0), available: Number(available[0]?.count ?? 0), borrowed: Number(borrowed[0]?.count ?? 0), overdue: Number(overdue[0]?.count ?? 0), members: Number(members[0]?.learners ?? 0), finesOutstanding: Number(fines[0]?.amount ?? 0) };
}

export async function libraryLookups() { const db = await requireDb(); return { categories: await db.select().from(libraryCategories).where(eq(libraryCategories.active, 1)).orderBy(libraryCategories.name), learners: await db.select({ id: learners.id, name: learners.fullName, admissionNumber: learners.admissionNumber }).from(learners).where(eq(learners.status, "active")).orderBy(learners.fullName).limit(500), staff: await db.select({ userId: users.id, name: staffProfiles.displayName, staffId: staffProfiles.staffId }).from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId)).where(eq(staffProfiles.status, "active")).orderBy(staffProfiles.displayName).limit(200) }; }

export async function listLibraryBooks(search?: string) {
  const db = await requireDb(); const term = search?.trim();
  const rows = await db.select({ book: libraryBooks, category: libraryCategories, copies: sql<number>`(select count(*) from library_copies c where c.bookId = library_books.id)`, available: sql<number>`(select count(*) from library_copies c where c.bookId = library_books.id and c.status = 'available')` }).from(libraryBooks).leftJoin(libraryCategories, eq(libraryCategories.id, libraryBooks.categoryId)).where(isNull(libraryBooks.deletedAt)).orderBy(libraryBooks.title);
  return term ? rows.filter(r => `${r.book.title} ${r.book.author ?? ""} ${r.book.isbn ?? ""}`.toLowerCase().includes(term.toLowerCase())) : rows;
}

export async function listLibraryLoans(overdueOnly = false) {
  const db = await requireDb();
  const rows = await db.select({ loan: libraryLoans, copy: libraryCopies, book: libraryBooks, learner: learners, staff: staffProfiles }).from(libraryLoans).innerJoin(libraryCopies, eq(libraryCopies.id, libraryLoans.copyId)).innerJoin(libraryBooks, eq(libraryBooks.id, libraryCopies.bookId)).leftJoin(learners, eq(learners.id, libraryLoans.learnerId)).leftJoin(staffProfiles, eq(staffProfiles.userId, libraryLoans.staffUserId)).where(overdueOnly ? and(isNull(libraryLoans.returnedOn), lt(libraryLoans.dueDate, dateOnly())) : undefined).orderBy(desc(libraryLoans.id));
  return rows;
}

export async function addLibraryBook(input: { title: string; author?: string | null; isbn?: string | null; publisher?: string | null; pubYear?: number | null; subject?: string | null; categoryId?: number | null; copies: number; location?: string | null }, userId: number) {
  const db = await requireDb(); const book = (await db.insert(libraryBooks).values({ title: input.title.trim(), author: input.author?.trim() || null, isbn: input.isbn?.trim() || null, publisher: input.publisher?.trim() || null, pubYear: input.pubYear ?? null, subject: input.subject?.trim() || null, categoryId: input.categoryId ?? null }).$returningId())[0];
  const count = Math.min(100, Math.max(1, input.copies)); const created: number[] = [];
  for (let i = 0; i < count; i++) { const accession = `LIB-${book.id}-${String(i + 1).padStart(3, "0")}`; const copy = (await db.insert(libraryCopies).values({ bookId: book.id, accessionNo: accession, barcode: accession, location: input.location?.trim() || null, acquiredOn: dateOnly() }).$returningId())[0]; created.push(copy.id); }
  await writeAudit(userId, "library.book.create", "library_book", book.id, { title: input.title, copies: count }); return { bookId: book.id, copies: created.length };
}

export async function checkoutLibraryBook(input: { copyId: number; learnerId?: number | null; staffUserId?: number | null; dueDays: number }, userId: number) {
  if (!input.learnerId && !input.staffUserId) throw new Error("LIBRARY_BORROWER_REQUIRED");
  const db = await requireDb(); const copy = (await db.select().from(libraryCopies).where(eq(libraryCopies.id, input.copyId)).limit(1))[0]; if (!copy || copy.status !== "available") throw new Error("LIBRARY_COPY_UNAVAILABLE");
  const loan = (await db.insert(libraryLoans).values({ copyId: input.copyId, learnerId: input.learnerId ?? null, staffUserId: input.staffUserId ?? null, loanedOn: dateOnly(), dueDate: dateOnly(Math.min(90, Math.max(1, input.dueDays))), issuedByUserId: userId }).$returningId())[0];
  await db.update(libraryCopies).set({ status: "borrowed" }).where(eq(libraryCopies.id, input.copyId)); await writeAudit(userId, "library.checkout", "library_loan", loan.id, input); return { loanId: loan.id };
}

export async function returnLibraryBook(loanId: number, userId: number) { const db = await requireDb(); const loan = (await db.select().from(libraryLoans).where(and(eq(libraryLoans.id, loanId), isNull(libraryLoans.returnedOn))).limit(1))[0]; if (!loan) throw new Error("LIBRARY_LOAN_NOT_FOUND"); await db.update(libraryLoans).set({ returnedOn: dateOnly() }).where(eq(libraryLoans.id, loanId)); await db.update(libraryCopies).set({ status: "available" }).where(eq(libraryCopies.id, loan.copyId)); await writeAudit(userId, "library.return", "library_loan", loanId, {}); return { ok: true }; }
export async function renewLibraryLoan(loanId: number, userId: number) { const db = await requireDb(); const loan = (await db.select().from(libraryLoans).where(and(eq(libraryLoans.id, loanId), isNull(libraryLoans.returnedOn))).limit(1))[0]; if (!loan) throw new Error("LIBRARY_LOAN_NOT_FOUND"); if (loan.renewedCount >= 2) throw new Error("LIBRARY_RENEWAL_LIMIT"); await db.update(libraryLoans).set({ dueDate: dateOnly(14), renewedCount: loan.renewedCount + 1 }).where(eq(libraryLoans.id, loanId)); await writeAudit(userId, "library.renew", "library_loan", loanId, {}); return { ok: true }; }
