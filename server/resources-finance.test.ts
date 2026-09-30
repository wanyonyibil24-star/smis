import { describe, expect, it } from "vitest";
import { maskResourcesFinanceState, mergeResourcesFinanceState, validateResourcesFinanceState } from "./resources-finance";

const context = {
  school: "Demo School", year: 2026, term: "Term 3", grades: ["Grade 7"],
  learners: [{ id: 1, adm: "A-1", name: "Amina Wanjiku", grade: "Grade 7", stream: "A", guardian: "Grace Wanjiku", phone: "0712000000" }],
};
const state = () => ({
  seq: {}, set: { school: "Demo School", year: "2026", term: "Term 3", pstart: "2026-01-01", open: 0, overpay: false, grades: ["Grade 7"], cin: [], cout: [] },
  lrn: [{ id: "L-0001", adm: "A-1", name: "Amina Wanjiku", grade: "Grade 7", stream: "A", guardian: "Grace Wanjiku", phone: "0712000000" }],
  fee: [], inv: [], pay: [], adj: [], tx: [], bud: {}, sup: [{ id: "S1", name: "Stationers" }], req: [], itm: [], mv: [], ast: [], mnt: [], log: [],
});
const fullAccess = { canRead: true, canWrite: true, canFinanceRead: true, canFinanceWrite: true, canStoreRead: true, canStoreWrite: true, moduleRole: "Super Admin" };

describe("Resources & Finance access boundaries", () => {
  it("does not expose stores to a finance-only reader", () => {
    const visible = maskResourcesFinanceState(state(), { ...fullAccess, canStoreRead: false, canStoreWrite: false }, context);
    expect(visible.sup).toEqual([]);
    expect(visible.itm).toEqual([]);
    expect(visible.lrn).toHaveLength(1);
  });

  it("does not expose learner or finance data to a stores-only reader", () => {
    const visible = maskResourcesFinanceState(state(), { ...fullAccess, canFinanceRead: false, canFinanceWrite: false }, context);
    expect(visible.lrn).toEqual([]);
    expect(visible.pay).toEqual([]);
    expect(visible.set.open).toBe(0);
    expect(visible.sup).toHaveLength(1);
  });

  it("rejects unsafe record IDs used by inline actions", () => {
    const unsafe = state();
    unsafe.sup[0].id = "S1');alert(1);//";
    expect(() => validateResourcesFinanceState(JSON.stringify(unsafe))).toThrow("INVALID_MODULE_ROW_ID");
  });

  it("preserves finance values when a stores editor submits a combined state", () => {
    const previous = state();
    const incoming = state();
    incoming.set.open = 999999;
    incoming.pay.push({ id: "P-0001", lid: "L-0001", amt: 999999 });
    incoming.sup.push({ id: "S-0001", name: "New supplier" });
    const access = { ...fullAccess, canFinanceRead: false, canFinanceWrite: false };
    const merged = mergeResourcesFinanceState(incoming, previous, access, { ...context, learners: [] }, 4);
    expect(merged.set.open).toBe(0);
    expect(merged.pay).toEqual([]);
    expect(merged.sup).toHaveLength(2);
  });

  it("rejects HTML injection in persisted user-controlled strings", () => {
    const unsafe = state();
    unsafe.sup[0].name = "<img src=x onerror=alert(1)>";
    expect(() => validateResourcesFinanceState(JSON.stringify(unsafe))).toThrow("UNSAFE_MODULE_TEXT");
  });
});
