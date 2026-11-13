import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import * as meta from "./kaizenMeta";
import ru from "./i18n/ru";

const require = createRequire(import.meta.url);
const server = require("../../server/src/config.js");

describe("kaizenMeta совпадает с серверной конфигурацией", () => {
  it.each([
    ["CATEGORIES"], ["WASTES"], ["EFFECTS"], ["IMPL_STATUSES"], ["EFFORTS"], ["CURRENCIES"], ["BETTER"], ["STATUSES"], ["PHOTO_BLOCKS"],
  ])("%s", (name) => expect(meta[name]).toEqual(server[name]));

  it("лимиты", () => {
    expect(meta.MAX_PHOTOS_PER_BLOCK).toBe(server.MAX_PHOTOS_PER_BLOCK);
    expect(meta.MAX_PHOTO_BYTES).toBe(server.MAX_PHOTO_BYTES);
    expect(meta.MAX_MEASURES).toBe(server.MAX_MEASURES);
  });

  it("для каждого значения списков есть перевод", () => {
    const prefixes = { CATEGORIES: "kz.cat", WASTES: "kz.waste", EFFECTS: "kz.effect", IMPL_STATUSES: "kz.impl", EFFORTS: "kz.effort", BETTER: "kz.better", STATUSES: "kz.status" };
    for (const [list, prefix] of Object.entries(prefixes)) for (const v of meta[list]) expect(ru[`${prefix}.${v}`], `${prefix}.${v}`).toBeTruthy();
  });
});

describe("расчёт замеров", () => {
  it("процент изменения", () => {
    expect(meta.changePct(12, 8)).toBe(-33.3);
    expect(meta.changePct("100", "130")).toBe(30);
    expect(meta.changePct(0, 5)).toBeNull();
    expect(meta.changePct("", 5)).toBeNull();
    expect(meta.changePct(-10, -5)).toBe(50);
  });
  it("улучшение с учётом направления", () => {
    expect(meta.isImproved(12, 8, "lower")).toBe(true);
    expect(meta.isImproved(12, 8, "higher")).toBe(false);
    expect(meta.isImproved(5, 5, "lower")).toBeNull();
    expect(meta.isImproved("x", 1, "lower")).toBeNull();
  });
});
