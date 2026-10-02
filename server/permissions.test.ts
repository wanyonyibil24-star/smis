import { describe, expect, it } from "vitest";
import { permissionCatalog, permissionsByRole } from "./smis";

describe("NEXUS-SMIS permission model", () => {
  it("includes the critical granular permissions", () => {
    const keys = permissionCatalog.map(([key]) => key);
    expect(keys).toEqual(expect.arrayContaining([
      "learners.add",
      "learners.deactivate",
      "attendance.edit",
      "assessments.edit",
      "finance.edit",
      "store.edit",
      "settings.edit",
      "ai.access",
    ]));
  });

  it("keeps role defaults least-privilege by default", () => {
    expect(permissionsByRole.teacher).not.toContain("finance.view");
    expect(permissionsByRole.finance).toContain("finance.view");
    expect(permissionsByRole.storekeeper).toContain("store.edit");
  });
});
