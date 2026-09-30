export type LegacyDate = Date | string | null | undefined;
export type LegacyNumber = number | string;

export type LegacyResourcesFinanceSnapshot = {
  school?: { schoolName?: string | null; academicYear?: number | null; currentTerm?: string | null } | null;
  grades: Array<{ id: number; name: string; stream?: string | null }>;
  learners: Array<{
    id: number; admissionNumber: string; fullName: string; guardianName?: string | null;
    guardianPhone?: string | null; gradeId: number; status?: string;
  }>;
  feeStructures: Array<{
    id: number; gradeId: number; term: string; academicYear: number;
    itemName: string; amount: LegacyNumber;
  }>;
  payments: Array<{
    id: number; learnerId: number; amount: LegacyNumber; paymentMethod: string;
    reference: string; paidAt: LegacyDate;
  }>;
  expenditures: Array<{
    id: number; expenditureDate: LegacyDate; amount: LegacyNumber;
    category: string; description: string; responsiblePerson: string;
  }>;
  storeItems: Array<{ id: number; name: string; unit: string; reorderLevel: LegacyNumber }>;
  storeMovements: Array<{
    id: number; itemId: number; movementType: string; quantity: LegacyNumber;
    reference?: string | null; createdAt: LegacyDate;
  }>;
};

export type LegacyResourcesFinanceSummary = {
  sourceLearners: number;
  importedLearners: number;
  feeRows: number;
  currentFeeTemplates: number;
  invoices: number;
  payments: number;
  expenditures: number;
  cashbookTransactions: number;
  storeItems: number;
  storeMovements: number;
  orphanPayments: number;
  unmatchedStoreMovements: number;
  sanitizedFields: number;
};

type StateRow = Record<string, any>;

function recordId(prefix: string, value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("LEGACY_IMPORT_INVALID_ID");
  return `${prefix}-${String(value).padStart(4, "0")}`;
}

function numericId(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("LEGACY_IMPORT_INVALID_ID");
  return result;
}

function decimal(value: LegacyNumber): number {
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1_000_000_000_000) throw new Error("LEGACY_IMPORT_INVALID_NUMBER");
  return Math.round((result + Math.sign(result) * Number.EPSILON) * 100) / 100;
}

function dateOnly(value: LegacyDate): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function isoTimestamp(value: LegacyDate): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

export function buildLegacyResourcesFinanceState(snapshot: LegacyResourcesFinanceSnapshot): {
  state: StateRow;
  summary: LegacyResourcesFinanceSummary;
} {
  let sanitizedFields = 0;
  const safeText = (value: unknown, limit = 4_000): string => {
    const original = String(value ?? "");
    const clean = original.replace(/[<>\"]/g, " ").replace(/[\u0000-\u001f]/g, " ").slice(0, limit).trim();
    if (clean !== original) sanitizedFields += 1;
    return clean;
  };
  const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  const yearValue = Number(snapshot.school?.academicYear);
  const year = Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 3000 ? yearValue : new Date().getFullYear();
  const term = safeText(snapshot.school?.currentTerm, 40) || "Term 1";
  const school = safeText(snapshot.school?.schoolName, 200) || "Your School";
  const gradeRows = [...snapshot.grades].sort((a, b) => a.id - b.id);
  const gradeById = new Map(gradeRows.map(row => [numericId(row.id), safeText(row.name, 80) || `Grade ${row.id}`]));
  const gradeDetailsById = new Map(gradeRows.map(row => [numericId(row.id), row]));
  const gradeName = (id: number) => gradeById.get(numericId(id)) ?? `Grade ${numericId(id)}`;
  const gradeNames = unique(gradeRows.map(row => gradeName(row.id))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const admissions = new Set<string>();
  const usedLearnerIds = new Set<number>();
  const learnerByLegacyId = new Map<number, { id: string; name: string; guardian: string; gradeId: number }>();
  const learners: StateRow[] = [];
  const makeAdmission = (value: unknown, legacyId: number): string => {
    const base = safeText(value, 40) || `LEGACY-${legacyId}`;
    if (!admissions.has(base)) {
      admissions.add(base);
      return base;
    }
    let ordinal = 1;
    let candidate = "";
    do {
      const suffix = `-${legacyId}${ordinal === 1 ? "" : `-${ordinal}`}`;
      candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
      ordinal += 1;
    } while (admissions.has(candidate));
    admissions.add(candidate);
    sanitizedFields += 1;
    return candidate;
  };
  const sortedLegacyLearners = [...snapshot.learners].sort((a, b) => a.id - b.id);
  for (const row of sortedLegacyLearners) {
    const legacyId = numericId(row.id);
    if (usedLearnerIds.has(legacyId)) throw new Error("LEGACY_IMPORT_DUPLICATE_LEARNER_ID");
    usedLearnerIds.add(legacyId);
    const id = recordId("L", legacyId);
    const name = safeText(row.fullName, 160) || `Learner ${legacyId}`;
    const guardian = safeText(row.guardianName, 160);
    const details = gradeDetailsById.get(numericId(row.gradeId));
    learners.push({
      id,
      adm: makeAdmission(row.admissionNumber, legacyId),
      name,
      grade: gradeName(row.gradeId),
      stream: safeText(details?.stream, 80),
      guardian,
      phone: safeText(row.guardianPhone, 40),
      cat: "All",
    });
    learnerByLegacyId.set(legacyId, { id, name, guardian, gradeId: numericId(row.gradeId) });
  }

  let orphanPayments = 0;
  const ensureLearner = (legacyIdValue: number) => {
    const legacyId = numericId(legacyIdValue);
    const existing = learnerByLegacyId.get(legacyId);
    if (existing) return existing;
    orphanPayments += 1;
    const placeholder = {
      id: recordId("L", legacyId),
      adm: makeAdmission(`LEGACY-${legacyId}`, legacyId),
      name: `Unmatched legacy learner ${legacyId}`,
      grade: "Unassigned",
      stream: "",
      guardian: "",
      phone: "",
      cat: "All",
      legacyUnmatched: true,
    };
    learners.push(placeholder);
    const mapped = { id: placeholder.id, name: placeholder.name, guardian: "", gradeId: -1 };
    learnerByLegacyId.set(legacyId, mapped);
    return mapped;
  };

  const feeRows = [...snapshot.feeStructures].sort((a, b) => a.id - b.id).map(row => ({
    id: numericId(row.id), gradeId: numericId(row.gradeId), year: numericId(row.academicYear),
    term: safeText(row.term, 40) || "Unspecified term", grade: gradeName(row.gradeId),
    name: safeText(row.itemName, 120) || `Fee item ${row.id}`, amount: decimal(row.amount),
  }));
  const currentFeeTemplates = feeRows
    .filter(row => row.year === year && row.term === term)
    .map(row => ({ grade: row.grade, name: row.name, amt: row.amount, cat: "All" }));

  // The legacy overview summed every fee_structure row for each learner's grade, without
  // filtering by year or term. Preserve that displayed total as period-grouped invoices;
  // only the active school year/term is retained as the reusable fee template.
  const feesByGrade = new Map<number, typeof feeRows>();
  for (const fee of feeRows) feesByGrade.set(fee.gradeId, [...(feesByGrade.get(fee.gradeId) ?? []), fee]);
  const invoices: StateRow[] = [];
  let invoiceSequence = 0;
  for (const row of sortedLegacyLearners) {
    const legacyId = numericId(row.id);
    const mappedLearner = learnerByLegacyId.get(legacyId)!;
    const periods = new Map<string, Array<(typeof feeRows)[number]>>();
    for (const fee of feesByGrade.get(numericId(row.gradeId)) ?? []) {
      const key = JSON.stringify([fee.year, fee.term]);
      periods.set(key, [...(periods.get(key) ?? []), fee]);
    }
    const sortedPeriods = Array.from(periods.values()).sort((a, b) => {
      const yearDifference = a[0].year - b[0].year;
      return yearDifference || a[0].term.localeCompare(b[0].term, undefined, { numeric: true });
    });
    for (const periodFees of sortedPeriods) {
      const first = periodFees[0];
      if (!first || periodFees.length === 0) continue;
      invoiceSequence += 1;
      invoices.push({
        id: recordId("INV", invoiceSequence),
        lid: mappedLearner.id,
        year: String(first.year),
        term: first.term,
        date: "",
        lines: periodFees.map(fee => ({ name: fee.name, amt: fee.amount })),
        legacyScheduleImport: true,
      });
    }
  }

  const payments = [...snapshot.payments].sort((a, b) => {
    const dateDifference = dateOnly(a.paidAt).localeCompare(dateOnly(b.paidAt));
    return dateDifference || a.id - b.id;
  });
  const paymentReferenceSet = new Set<string>();
  const importedPayments: StateRow[] = [];
  const transactionEvents: Array<{ date: string; sourceId: number; kind: number; row: StateRow }> = [];
  const methodMap: Record<string, string> = { mpesa: "M-Pesa", bank: "Bank", cash: "Cash" };
  for (const row of payments) {
    const legacyId = numericId(row.id);
    const learner = ensureLearner(row.learnerId);
    const amount = decimal(row.amount);
    let reference = safeText(row.reference, 80);
    if (!reference || paymentReferenceSet.has(reference)) reference = `LEGACY-PAY-${legacyId}`;
    let suffix = 1;
    const referenceBase = reference;
    while (paymentReferenceSet.has(reference)) reference = `${referenceBase}-${suffix++}`.slice(0, 80);
    paymentReferenceSet.add(reference);
    const date = dateOnly(row.paidAt);
    const method = methodMap[String(row.paymentMethod).toLowerCase()] ?? "Not recorded";
    const id = recordId("P", legacyId);
    const rcp = recordId("RCP", legacyId);
    importedPayments.push({ id, rcp, lid: learner.id, amt: amount, method, ref: reference, date, payer: learner.guardian || learner.name, void: 0 });
    transactionEvents.push({
      date,
      sourceId: legacyId,
      kind: 0,
      row: {
        date,
        desc: `${amount < 0 ? "Legacy fee refund" : "Legacy fee payment"} – ${learner.name} (${rcp})`,
        cat: "School Fees",
        amt: Math.abs(amount),
        dir: amount < 0 ? "out" : "in",
        method,
        ref: reference,
        src: `pay:${id}`,
        status: "Approved",
        user: "Legacy import",
        at: isoTimestamp(row.paidAt),
        void: 0,
      },
    });
  }

  const expenses = [...snapshot.expenditures].sort((a, b) => {
    const dateDifference = dateOnly(a.expenditureDate).localeCompare(dateOnly(b.expenditureDate));
    return dateDifference || a.id - b.id;
  });
  const expenseCategories = unique(expenses.map(row => safeText(row.category, 120)));
  for (const row of expenses) {
    const legacyId = numericId(row.id);
    const amount = decimal(row.amount);
    const date = dateOnly(row.expenditureDate);
    const category = safeText(row.category, 120) || "Other Expenses";
    const reference = `LEGACY-EXP-${legacyId}`;
    transactionEvents.push({
      date,
      sourceId: legacyId,
      kind: 1,
      row: {
        date,
        desc: safeText(row.description, 255) || `Legacy expenditure ${legacyId}`,
        cat: category,
        amt: Math.abs(amount),
        dir: amount < 0 ? "in" : "out",
        method: "Not recorded",
        ref: reference,
        doc: reference,
        src: `legacy:expenditure:${legacyId}`,
        status: "Approved",
        user: safeText(row.responsiblePerson, 160) || "Not recorded",
        void: 0,
      },
    });
  }
  transactionEvents.sort((a, b) => a.date.localeCompare(b.date) || a.kind - b.kind || a.sourceId - b.sourceId);
  const transactions = transactionEvents.map((event, index) => ({ id: recordId("T", index + 1), ...event.row }));

  const items = new Map<number, StateRow>();
  for (const row of [...snapshot.storeItems].sort((a, b) => a.id - b.id)) {
    const legacyId = numericId(row.id);
    if (items.has(legacyId)) throw new Error("LEGACY_IMPORT_DUPLICATE_STORE_ITEM_ID");
    items.set(legacyId, {
      id: recordId("I", legacyId),
      name: safeText(row.name, 160) || `Legacy store item ${legacyId}`,
      cat: "Other",
      unit: safeText(row.unit, 30) || "Unit",
      min: decimal(row.reorderLevel),
      cost: 0,
      legacyUnpriced: true,
    });
  }
  let unmatchedStoreMovements = 0;
  const movements: StateRow[] = [];
  const sourceStoreItemIds = new Set(snapshot.storeItems.map(row => numericId(row.id)));
  for (const row of [...snapshot.storeMovements].sort((a, b) => a.id - b.id)) {
    const itemId = numericId(row.itemId);
    if (!sourceStoreItemIds.has(itemId)) unmatchedStoreMovements += 1;
    if (!items.has(itemId)) {
      items.set(itemId, {
        id: recordId("I", itemId),
        name: `Unmatched legacy stock item ${itemId}`,
        cat: "Other",
        unit: "Unit",
        min: 0,
        cost: 0,
        legacyUnmatched: true,
      });
    }
    const quantity = decimal(row.quantity);
    const type = row.movementType === "received" ? "in" : row.movementType === "issued" ? "out" : "adj";
    // The legacy store overview added received/adjustment quantities and subtracted issued quantities.
    const q = row.movementType === "issued" ? -quantity : quantity;
    movements.push({
      id: recordId("M", numericId(row.id)),
      item: items.get(itemId)!.id,
      type,
      q,
      to: "",
      date: dateOnly(row.createdAt),
      ref: safeText(row.reference, 120) || `LEGACY-MOVE-${row.id}`,
      note: "Imported from legacy store movement ledger",
    });
  }

  const state: StateRow = {
    seq: {
      inv: invoiceSequence,
      pay: Math.max(0, ...payments.map(row => numericId(row.id))),
      rcp: Math.max(0, ...payments.map(row => numericId(row.id))),
      adj: 0,
      tx: transactions.length,
      sup: 0,
      req: 0,
      itm: Math.max(0, ...Array.from(items.keys())),
      mv: Math.max(0, ...movements.map(row => Number(String(row.id).split("-").at(-1)))),
      ast: 0,
      mnt: 0,
    },
    set: {
      school,
      year: String(year),
      term,
      pstart: `${year}-01-01`,
      open: 0,
      overpay: false,
      grades: gradeNames,
      cin: ["School Fees", "Grants / Capitation", "Donations", "Other Income"],
      cout: unique(["Utilities", "Salaries & Wages", "Teaching Materials", "Maintenance", "Food & Catering", "Transport", "Stationery", "Other Expenses", ...expenseCategories]),
    },
    lrn: learners,
    fee: currentFeeTemplates,
    inv: invoices,
    pay: importedPayments,
    adj: [],
    tx: transactions,
    bud: {},
    sup: [],
    req: [],
    itm: Array.from(items.values()),
    mv: movements,
    ast: [],
    mnt: [],
    log: [],
  };

  return {
    state,
    summary: {
      sourceLearners: snapshot.learners.length,
      importedLearners: learners.length,
      feeRows: feeRows.length,
      currentFeeTemplates: currentFeeTemplates.length,
      invoices: invoices.length,
      payments: importedPayments.length,
      expenditures: expenses.length,
      cashbookTransactions: transactions.length,
      storeItems: items.size,
      storeMovements: movements.length,
      orphanPayments,
      unmatchedStoreMovements,
      sanitizedFields,
    },
  };
}
