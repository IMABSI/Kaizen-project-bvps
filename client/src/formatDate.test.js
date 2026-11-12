import { describe, it, expect } from "vitest";
import { formatDateTime } from "./formatDate";

describe("formatDateTime (GMT+5)", () => {
  it("UTC из SQLite → время Ташкента", () => {
    expect(formatDateTime("2026-11-12 08:30:00", "ru")).toContain("13:30");
    expect(formatDateTime("2026-11-12 20:00:00", "en")).toContain("01:00"); // перешли за полночь
  });
  it("пустое и мусор", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
