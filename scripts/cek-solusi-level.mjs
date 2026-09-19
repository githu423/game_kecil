#!/usr/bin/env node
/**
 * cek-solusi-level.mjs — menjalankan solusi referensi 15 level Python Adventure
 * memakai Pyodide asli dari salinan lokal (vendor/pyodide/), lalu memeriksa
 * perilaku tambahan: argumen move_down(2), batas 500 aksi, pesan error, sensor.
 *
 * Skrip ini TIDAK butuh internet dan TIDAK butuh browser: Pyodide bisa berjalan
 * di Node.js. Karena itu, kode yang sama dengan Web Worker di browser bisa diuji
 * di sini (memakai runPlayerCode dari games/python-adventure/runner.js).
 *
 * Pemakaian:
 *   node scripts/cek-solusi-level.mjs
 */

import { fileURLToPath } from "node:url";
import { loadPyodide } from "../vendor/pyodide/pyodide.mjs";
import { LEVELS } from "../games/python-adventure/levels.js";
import { LIMITS, parsePythonError, runPlayerCode } from "../games/python-adventure/runner.js";

const INDEX_URL = fileURLToPath(new URL("../vendor/pyodide/", import.meta.url));

let gagal = 0;
const lulus = (nama, info = "") => console.log(`✅ ${nama}${info ? ` — ${info}` : ""}`);
const tidak = (nama, info = "") => {
  gagal += 1;
  console.log(`❌ ${nama}${info ? ` — ${info}` : ""}`);
};
const cek = (nama, syarat, info = "") => (syarat ? lulus(nama, info) : tidak(nama, info));

console.log("Menyiapkan Pyodide dari salinan lokal…");
const py = await loadPyodide({ indexURL: INDEX_URL });
console.log(`Pyodide ${py.version} siap.\n`);

/* --- 1. Solusi referensi setiap level ------------------------------------- */

console.log("--- Solusi referensi 15 level ---");
for (const level of LEVELS) {
  const hasil = await runPlayerCode(py, { code: level.solution, level });
  const masalah = [];
  if (!hasil.ok) {
    masalah.push(`ERROR ${hasil.error.kind}: ${String(hasil.error.message).split("\n").slice(-2).join(" | ")}`);
  }
  if (!hasil.reachedGoal) masalah.push("tidak sampai tujuan");
  if (level.maxActions && hasil.actionCount > level.maxActions) {
    masalah.push(`aksi ${hasil.actionCount} > batas tantangan ${level.maxActions}`);
  }

  const kolom = `${String(level.id).padStart(2)}. ${level.title.padEnd(24)}`;
  if (masalah.length) tidak(kolom, masalah.join("; "));
  else lulus(kolom, `aksi ${hasil.actionCount}/${level.maxActions ?? "-"} • ${hasil.events.length} event`);
}

/* --- 2. Argumen jumlah langkah pada move_* -------------------------------- */

console.log("\n--- Argumen jumlah langkah (move_down(2) dst.) ---");

/** Koridor panjang: dari S masih ada 3 tile kosong ke kanan sebelum dinding. */
const koridor = { grid: ["########", "#..S..G#", "########"], facing: "right" };
/** Koridor pendek: hanya ada 1 langkah ke kanan sebelum dinding. */
const koridorSempit = { grid: ["#####", "#.S.#", "#.G.#", "#####"], facing: "right" };

async function jalankan(kode, level = koridor) {
  return runPlayerCode(py, { code: kode, level });
}

let hasil = await jalankan("move_right(2)\n");
cek(
  "move_right(2) menghasilkan 2 event gerak",
  hasil.events.length === 2 && hasil.events.every((e) => e.type === "move" && e.ok),
  `aksi=${hasil.actionCount} kolom=${hasil.events.at(-1)?.col}`,
);
cek(
  "move_right(2) memakai satu nomor baris (baris 1)",
  hasil.events.every((e) => e.line === 1),
  `line=${hasil.events.map((e) => e.line).join(",")}`,
);
cek(
  "move_right(2) menggeser karakter 2 tile dari posisi awal (kolom 3 → 5)",
  hasil.events[0]?.col === 4 && hasil.events[1]?.col === 5,
  `kolom tiap event: ${hasil.events.map((e) => e.col).join(" → ")}`,
);

hasil = await jalankan("move_right()\n");
cek("move_right() default tetap 1 langkah", hasil.events.length === 1, `aksi=${hasil.actionCount}`);

hasil = await jalankan("move_right(3)\n", koridorSempit);
cek(
  "move_right(3) berhenti setelah tertabrak (2 event, terakhir gagal)",
  hasil.events.length === 2 && hasil.events[0].ok === true && hasil.events[1].ok === false,
  `event=${hasil.events.map((e) => (e.ok ? "ok" : "nabrak")).join(",")}`,
);

hasil = await jalankan("move_right(2)\nfor i in range(3):\n    move_left()\n");
cek(
  "kombinasi move_right(2) + perulangan tetap terhitung",
  hasil.actionCount === 5 && hasil.events.length === 5,
  `aksi=${hasil.actionCount} event=${hasil.events.length}`,
);

const kasusArgumen = [
  ["move_right(0)", "0", "minimal 1"],
  ["move_right(-2)", "-2", "minimal 1"],
  ["move_right(2.5)", "2.5", "bilangan bulat"],
  ['move_right("2")', '"2"', "bilangan bulat"],
  ["move_right(True)", "True", "bilangan bulat"],
  ["move_right(999)", "999", "maksimal 50"],
];
for (const [kode, label, harapan] of kasusArgumen) {
  const keluaran = await jalankan(`${kode}\n`);
  const parsed = keluaran.error ? parsePythonError(keluaran.error.message) : null;
  const benar =
    parsed?.type === "ArgumenError" && parsed.line === 1 && parsed.friendly.includes(harapan);
  cek(
    `move_right(${label}) ditolak dengan pesan ramah`,
    benar,
    parsed ? `${parsed.type} baris ${parsed.line}: ${parsed.friendly}` : "tidak ada error",
  );
}

hasil = await jalankan("move_right(60)\n");
const parsedLimit = hasil.error ? parsePythonError(hasil.error.message) : null;
cek(
  "move_right(60) ditolak karena melebihi 50 langkah per perintah",
  parsedLimit?.type === "ArgumenError" && parsedLimit.line === 1,
  parsedLimit?.friendly ?? "tidak ada error",
);

/* --- 3. Batas 500 aksi ---------------------------------------------------- */

console.log("\n--- Batas aksi & keamanan ---");
hasil = await jalankan("for i in range(600):\n    move_right()\n");
cek(
  "lebih dari 500 aksi dihentikan dengan pesan batas aksi",
  hasil.error?.kind === "action-limit" && hasil.actionCount === LIMITS.maxActions,
  `kind=${hasil.error?.kind} aksi=${hasil.actionCount}`,
);

hasil = await jalankan("print('halo', 2+3)\n");
cek("print() masuk ke panel Output", hasil.output.trim() === "halo 5", JSON.stringify(hasil.output));

hasil = await jalankan("def f():\n    return 1\n");
cek("def tanpa gerak tidak sampai tujuan", hasil.reachedGoal === false && hasil.actionCount === 0);

/* --- 4. Sensor, serangan, dan error Python -------------------------------- */

console.log("\n--- Sensor, serangan, error ---");
console.log(
  "(catatan: penghentian loop tak terbatas lewat batas waktu 5 detik hanya bisa diuji di browser/worker)",
);
const sensor = { grid: ["#####", "#..S#", "#..G#", "#####"], facing: "right" };
hasil = await jalankan(
  "print(is_blocked('right'))\nprint(can_attack('right'))\nprint(at_goal())\n",
  sensor,
);
cek(
  "sensor is_blocked/can_attack/at_goal bekerja",
  hasil.output.trim() === "True\nFalse\nFalse",
  JSON.stringify(hasil.output.trim()),
);

const batu = { grid: ["#####", "#SRG#", "#####"], facing: "right" };
hasil = await runPlayerCode(py, { code: "attack()\nmove_right()\n", level: batu });
cek(
  "attack() menghancurkan batu lalu bisa lewat",
  hasil.events[0]?.result === "destroyed" && hasil.events[1]?.ok === true,
  `hasil serangan=${hasil.events[0]?.result}`,
);

hasil = await runPlayerCode(py, {
  code: "attack()\n",
  level: { grid: ["###", "#S#", "#G#", "###"], facing: "up" },
});
cek(
  "attack() ke dinding = tidak mempan (bukan error)",
  hasil.events[0]?.result === "wall" && !hasil.error,
  `result=${hasil.events[0]?.result}`,
);

hasil = await jalankan("def f(:\n    pass\n");
cek(
  "SyntaxError diterjemahkan + nomor baris",
  parsePythonError(hasil.error.message).type === "SyntaxError" &&
    parsePythonError(hasil.error.message).line === 1,
  parsePythonError(hasil.error.message).friendly,
);

hasil = await jalankan("move_righ()\n");
const parsedNama = parsePythonError(hasil.error.message);
cek(
  "NameError salah ketik diberi saran fungsi",
  parsedNama.type === "NameError" && parsedNama.friendly.includes("move_right"),
  parsedNama.friendly,
);

hasil = await jalankan("input()\n");
cek(
  "input() ditolak dengan pesan ramah",
  String(hasil.error?.message ?? "").includes("input() tidak tersedia"),
  parsePythonError(hasil.error.message).friendly,
);

/* --- Ringkasan ------------------------------------------------------------ */

console.log(
  gagal === 0
    ? "\nSemua pemeriksaan lulus ✅"
    : `\n${gagal} pemeriksaan GAGAL ❌`,
);
process.exit(gagal === 0 ? 0 : 1);
