import { describe, it, expect } from "vitest";
import ru from "./ru";
import uz from "./uz";
import en from "./en";
import { translate, translateError } from "./index.jsx";

const keys = (d) => Object.keys(d).sort();

describe("словари", () => {
  it("ключи ru / uz / en совпадают", () => {
    expect(keys(uz)).toEqual(keys(ru));
    expect(keys(en)).toEqual(keys(ru));
  });
  it("нет пустых значений, плейсхолдеры совпадают между языками", () => {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    for (const k of keys(ru)) {
      for (const d of [ru, uz, en]) expect(d[k].trim(), k).not.toBe("");
      expect(ph(uz[k]), k).toBe(ph(ru[k]));
      expect(ph(en[k]), k).toBe(ph(ru[k]));
    }
  });
});

describe("translate", () => {
  it("подставляет переменные и откатывается к ru и к ключу", () => {
    expect(translate("en", "users.codeNote", { date: "X" })).toContain("X");
    expect(translate("en", "no.such.key")).toBe("no.such.key");
    expect(translate("xx", "nav.logout")).toBe(ru["nav.logout"]);
  });
});

describe("translateError", () => {
  it("переводит по code, иначе — текст сервера, сеть, generic", () => {
    const err = (data) => ({ response: { data } });
    expect(translateError("en", err({ code: "tabel_taken", error: "рус" }))).toBe(en["err.tabel_taken"]);
    expect(translateError("uz", err({ code: "tabel_taken" }))).toBe(uz["err.tabel_taken"]);
    expect(translateError("en", err({ code: "unknown_code", error: "Сообщение" }))).toBe("Сообщение");
    expect(translateError("en", {})).toBe(en["err.network"]);
    expect(translateError("en", err({}))).toBe(en["err.generic"]);
  });
  it("у каждого серверного code есть перевод", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../../../server/src");
    const codes = new Set();
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(path.join(d, f.name));
        else if (f.name.endsWith(".js")) {
          const src = fs.readFileSync(path.join(d, f.name), "utf8");
          for (const m of src.matchAll(/fail\(res,\s*\d+,\s*"(\w+)"/g)) codes.add(m[1]);
          for (const m of src.matchAll(/code: "(\w+)"/g)) codes.add(m[1]);
        }
      }
    };
    walk(dir);
    const missing = [...codes].filter((c) => !ru[`err.${c}`]);
    expect(missing).toEqual([]);
  });
});
