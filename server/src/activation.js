const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const config = require("./config");

// No 0/O, 1/I/L: the code is read aloud and copied by hand on the shop floor.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode() {
  let code = "";
  for (let i = 0; i < config.ACTIVATION_CODE_LENGTH; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

/** Upper-case, drop spaces and dashes, so "abcd-2345" and "ABCD 2345" both work. */
function normalizeCode(input) {
  return String(input || "").toUpperCase().replace(/[\s-]/g, "");
}

function formatCode(code) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function hashCode(code) {
  return bcrypt.hashSync(normalizeCode(code), 10);
}

function verifyCode(code, hash) {
  return !!hash && bcrypt.compareSync(normalizeCode(code), hash);
}

/** SQLite-style UTC timestamp ("YYYY-MM-DD HH:MM:SS") `days` from now. */
function expiryFromNow(days = config.ACTIVATION_TTL_DAYS) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

function isExpired(sqliteUtc) {
  if (!sqliteUtc) return true;
  return new Date(`${sqliteUtc.replace(" ", "T")}Z`).getTime() < Date.now();
}

module.exports = { generateCode, normalizeCode, formatCode, hashCode, verifyCode, expiryFromNow, isExpired };
