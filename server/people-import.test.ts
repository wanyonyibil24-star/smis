import { describe, expect, it } from "vitest";
import { isPeopleImportUndoable, PEOPLE_IMPORT_UNDO_WINDOW_MS } from "./smis";

describe("people import undo window", () => {
  it("allows undo within one hour and rejects older imports", () => {
    const createdAt = new Date("2026-10-12T08:00:00.000Z");
    expect(isPeopleImportUndoable(createdAt, createdAt.getTime() + PEOPLE_IMPORT_UNDO_WINDOW_MS)).toBe(true);
    expect(isPeopleImportUndoable(createdAt, createdAt.getTime() + PEOPLE_IMPORT_UNDO_WINDOW_MS + 1)).toBe(false);
  });
});
