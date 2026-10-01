import { describe, expect, it } from "vitest";
import { validateResourcesFinanceState } from "./resources-finance";
import { buildLegacyResourcesFinanceState, type LegacyResourcesFinanceSnapshot } from "./resources-finance-legacy";

const baseSnapshot = (): LegacyResourcesFinanceSnapshot => ({
  school: { schoolName: "Demo School", academicYear: 2026, currentTerm: "Term 1" },
  grades: [{ id: 1, name: "Grade 7", stream: "A" }],
  learners: [{ id: 7, admissionNumber: "ADM-7", fullName: "Amina Wanjiku", guardianName: "Grace Wanjiku", guardianPhone: "0712000000", gradeId: 1, status: "active" }],
  feeStructures: [
    { id: 1, gradeId: 1, academicYear: 2025, term: "Term 3", itemName: "Tuition", amount: "1000.00" },
    { id: 2, gradeId: 1, academicYear: 2026, term: "Term 1", itemName: "Tuition", amount: "2000.00" },
  ],
  payments: [{ id: 8, learnerId: 7, amount: "700.00", paymentMethod: "mpesa", reference: "MPESA-8", paidAt: "2026-01-05 08:30:00" }],
  expenditures: [{ id: 4, expenditureDate: "2026-01-08", amount: "100.00", category: "Utilities", description: "Electricity", responsiblePerson: "Administrator" }],
  storeItems: [{ id: 2, name: "Exercise books", unit: "Piece", reorderLevel: "2.00" }],
  storeMovements: [
    { id: 12, itemId: 2, movementType: "received", quantity: "10.00", reference: "GRN-12", createdAt: "2026-01-02 08:00:00" },
    { id: 13, itemId: 2, movementType: "issued", quantity: "3.00", reference: "ISS-13", createdAt: "2026-01-03 08:00:00" },
    { id: 14, itemId: 2, movementType: "adjustment", quantity: "1.00", reference: "ADJ-14", createdAt: "2026-01-04 08:00:00" },
  ],
});

describe("legacy Finance & Stores import mapping", () => {
  it("preserves legacy fee totals, payments, expenditure, and signed stock movement totals", () => {
    const { state, summary } = buildLegacyResourcesFinanceState(baseSnapshot());
    expect(state.fee).toEqual([{ grade: "Grade 7", name: "Tuition", amt: 2000, cat: "All" }]);
    expect(state.inv).toHaveLength(2);
    const billed = state.inv.reduce((total: number, invoice: any) => total + invoice.lines.reduce((sum: number, line: any) => sum + line.amt, 0), 0);
    const paid = state.pay.reduce((total: number, payment: any) => total + payment.amt, 0);
    expect(billed).toBe(3000);
    expect(paid).toBe(700);
    expect(billed - paid).toBe(2300);
    expect(state.pay[0]).toMatchObject({ id: "P-0008", rcp: "RCP-0008", lid: "L-0007", method: "M-Pesa", ref: "MPESA-8" });
    expect(state.tx.map((row: any) => row.dir)).toEqual(["in", "out"]);
    expect(state.tx.every((row: any) => row.status === "Approved")).toBe(true);
    expect(state.itm[0].id).toBe("I-0002");
    expect(state.mv.reduce((total: number, movement: any) => total + movement.q, 0)).toBe(8);
    expect(state.seq.rcp).toBe(8);
    expect(summary).toMatchObject({ invoices: 2, payments: 1, expenditures: 1, cashbookTransactions: 2, storeItems: 1, storeMovements: 3 });
    expect(() => validateResourcesFinanceState(JSON.stringify(state))).not.toThrow();
  });

  it("sanitizes unsafe text and retains orphaned payment and stock records with placeholders", () => {
    const snapshot = baseSnapshot();
    snapshot.learners[0].admissionNumber = 'ADM<"7';
    snapshot.learners[0].fullName = '<Amina "Wanjiku">';
    snapshot.payments.push({ id: 9, learnerId: 99, amount: "25.00", paymentMethod: "unknown", reference: 'REF<"9', paidAt: "2026-01-09" });
    snapshot.storeMovements.push({ id: 15, itemId: 77, movementType: "received", quantity: "2.00", reference: 'PO<"77', createdAt: "2026-01-10" });
    const { state, summary } = buildLegacyResourcesFinanceState(snapshot);
    expect(summary.orphanPayments).toBe(1);
    expect(summary.unmatchedStoreMovements).toBe(1);
    expect(summary.sanitizedFields).toBeGreaterThan(0);
    expect(state.lrn).toHaveLength(2);
    expect(state.pay[1].lid).toBe("L-0099");
    expect(state.pay[1].method).toBe("Not recorded");
    expect(state.itm.some((item: any) => item.id === "I-0077")).toBe(true);
    expect(() => validateResourcesFinanceState(JSON.stringify(state))).not.toThrow();
  });
});
