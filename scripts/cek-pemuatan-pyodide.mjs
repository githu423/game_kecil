#!/usr/bin/env node
/**
 * cek-pemuatan-pyodide.mjs — menguji mesin pemuatan Pyodide tanpa browser.
 *
 * Yang diuji:
 *   1. Protokol Web Worker (init → status → siap → run → hasil/error) memakai
 *      Pyodide ASLI dari salinan lokal. Caranya: global `self` disimulasikan,
 *      lalu modul runner.js dimuat sehingga bagian "kode di dalam worker" aktif.
 *   2. Mesin cadangan sumber: sumber rusak → pindah ke sumber berikutnya,
 *      batas waktu "koneksi macet", daftar lewati (skip), dan laporan teknis
 *      saat semua sumber gagal.
 *
 * Pemakaian:
 *   node scripts/cek-pemuatan-pyodide.mjs
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

let gagal = 0;
const lulus = (nama, info = "") => console.log(`✅ ${nama}${info ? ` — ${info}` : ""}`);
const tidak = (nama, info = "") => {
  gagal += 1;
  console.log(`❌ ${nama}${info ? ` — ${info}` : ""}`);
};
const cek = (nama, syarat, info = "") => (syarat ? lulus(nama, info) : tidak(nama, info));

/* --- 0. fetch yang bisa membaca berkas lokal (untuk sumber "file://") ------ */

const fetchAsli = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  if (url.startsWith("file://")) {
    const data = await readFile(fileURLToPath(new URL(url))); // melempar kalau tidak ada
    return new Response(data, {
      status: 200,
      headers: { "content-length": String(data.byteLength) },
    });
  }
  return fetchAsli(input, init);
};

/* --- 1. Simulasi Web Worker memakai Pyodide asli -------------------------- */

const pesan = [];
let listener = null;
globalThis.self = {
  postMessage: (message) => pesan.push(message),
  addEventListener: (type, handler) => {
    if (type === "message") listener = handler;
  },
};

const runner = await import("../games/python-adventure/runner.js");

/** Menunggu sampai salah satu pesan cocok (atau batas waktu habis). */
async function tungguSampai(cocok, batasMs = 40000) {
  const mulai = Date.now();
  while (Date.now() - mulai < batasMs) {
    const ketemu = pesan.find(cocok);
    if (ketemu) return ketemu;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

console.log("--- Protokol worker (Pyodide asli) ---");
cek("bagian worker aktif saat dijalankan tanpa DOM", Boolean(listener), "self.addEventListener terpasang");

listener({ data: { type: "init", skip: [] } });
const siap = await tungguSampai((m) => m.type === "status" && (m.stage === "ready" || m.stage === "error"));
cek("status \"ready\" benar-benar dikirim worker ke thread utama", siap?.stage === "ready", siap?.message ?? "timeout");
cek("sumber yang dipakai dilaporkan (lokal lebih dulu)", String(siap?.source).includes("lokal"), `source=${siap?.source}`);

const progres = pesan.find((m) => m.progress && m.progress.received > 0);
cek(
  "progres unduhan dilaporkan dengan byte nyata",
  Boolean(progres) && progres.progress.received > 0 && progres.progress.total > progres.progress.received,
  progres ? `${progres.message}` : "tidak ada pesan progres",
);
const labelBerkas = pesan.filter((m) => m.type === "status" && m.stage === "loading").length;
cek("ada pesan tahap pemuatan (unduh → siapkan)", labelBerkas >= 2, `${labelBerkas} pesan status`);

const grid = ["#####", "#..S#", "#...#", "#..G#", "#####"];
listener({ data: { type: "run", id: 7, code: "move_down(2)\n", grid, facing: "down" } });
const hasil = await tungguSampai((m) => m.type === "result" && m.id === 7);
cek(
  "move_down(2) mengirim 2 event gerak dari worker",
  hasil?.ok === true && hasil.events.length === 2 && hasil.events.every((e) => e.ok),
  `aksi=${hasil?.actionCount} event=${hasil?.events?.length}`,
);
cek("karakter sampai tujuan di grid uji", hasil?.reachedGoal === true);

pesan.length = 0;
listener({ data: { type: "run", id: 8, code: "move_righ()\n", grid, facing: "down" } });
const errorHasil = await tungguSampai((m) => m.type === "result" && m.id === 8);
const parsed = errorHasil?.error ? runner.parsePythonError(errorHasil.error.message) : null;
cek(
  "error Python dikirim ke thread utama (bukan crash)",
  errorHasil?.ok === false && parsed?.type === "NameError" && parsed.line === 1,
  parsed?.friendly ?? "tidak ada error",
);

pesan.length = 0;
listener({ data: { type: "run", id: 9, code: "print('halo')\nmove_down()\n", grid, facing: "down" } });
await tungguSampai((m) => m.type === "result" && m.id === 9);
cek(
  "print() diteruskan sebagai pesan stdout",
  pesan.some((m) => m.type === "stdout" && String(m.text).includes("halo")),
  "stdout diterima",
);

/* --- 2. Mesin cadangan sumber -------------------------------------------- */

console.log("\n--- Pemilihan sumber & batas waktu ---");
const lokalURL = new URL("../vendor/pyodide/", import.meta.url).href;
const sumberRusak = { id: "rusak", label: "sumber rusak (port tertutup)", indexURL: "http://127.0.0.1:9/" };
const sumberLokal = { id: "lokal", label: "salinan lokal", indexURL: lokalURL };

const statusPesan = [];
const hasilFallback = await runner.loadPyodideWithFallback({
  sources: [sumberRusak, sumberLokal],
  onStatus: (_stage, message) => statusPesan.push(message),
  onProgress: () => {},
  timeoutMs: 30000,
});
cek(
  "sumber rusak dilewati, lalu berhasil dari salinan lokal",
  hasilFallback.source.id === "lokal" && hasilFallback.attempts[0].ok === false,
  hasilFallback.attempts.map((a) => `${a.label}: ${a.ok ? "ok" : "gagal"}`).join(" | "),
);
cek(
  "UI diberi tahu saat pindah ke sumber berikutnya",
  statusPesan.some((m) => m.includes("Mencoba sumber berikutnya")),
  statusPesan.find((m) => m.includes("Mencoba sumber berikutnya")) ?? "-",
);

const lewati = await runner
  .loadPyodideWithFallback({ sources: [sumberLokal], skip: ["lokal"], timeoutMs: 3000 })
  .then(() => null)
  .catch((error) => error);
cek(
  "daftar \"skip\" dihormati (sumber yang sudah gagal tidak dicoba lagi)",
  lewati instanceof runner.PyodideLoadError && lewati.attempts.length === 0,
  lewati?.message,
);

const semuaGagal = await runner
  .loadPyodideWithFallback({ sources: [sumberRusak], timeoutMs: 4000 })
  .then(() => null)
  .catch((error) => error);
cek(
  "semua sumber gagal → PyodideLoadError dengan laporan teknis",
  semuaGagal instanceof runner.PyodideLoadError &&
    semuaGagal.technicalReport().includes("sumber rusak"),
  semuaGagal?.technicalReport().split("\n")[0],
);

// Koneksi yang macet: fetch tidak pernah menjawab, hanya menyerah saat dibatalkan.
const fetchMacet = (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  if (url.includes("macet")) {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("dibatalkan")));
    });
  }
  return globalThis.fetch(input, init);
};
const sumberMacet = { id: "macet", label: "sumber macet", indexURL: "http://lambat.test/macet/" };
const mulaiMacet = Date.now();
const hasilMacet = await runner.loadPyodideWithFallback({
  sources: [sumberMacet, sumberLokal],
  fetchImpl: fetchMacet,
  timeoutMs: 30000,
  stallTimeoutMs: 900,
});
const durasiMacet = Date.now() - mulaiMacet;
cek(
  "koneksi macet dibatalkan (bukan menggantung) lalu pindah sumber",
  hasilMacet.source.id === "lokal" && durasiMacet < 12000,
  `selesai dalam ${durasiMacet} ms; percobaan pertama: ${hasilMacet.attempts[0].error}`,
);

/* --- Ringkasan ------------------------------------------------------------ */

console.log(gagal === 0 ? "\nSemua pemeriksaan lulus ✅" : `\n${gagal} pemeriksaan GAGAL ❌`);
process.exit(gagal === 0 ? 0 : 1);
