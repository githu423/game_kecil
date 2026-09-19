#!/usr/bin/env node
/**
 * download-pyodide.mjs — mengunduh berkas Pyodide resmi ke vendor/pyodide/.
 *
 * Halaman Python Adventure memakai salinan lokal ini lebih dulu (tanpa internet),
 * dan baru memakai CDN sebagai cadangan. Skrip ini TIDAK memakai dependensi npm
 * apa pun: cukup Node.js 18+ (sudah punya fetch bawaan).
 *
 * Pemakaian:
 *   node scripts/download-pyodide.mjs                    # unduh dari CDN resmi
 *   node scripts/download-pyodide.mjs --verify           # hanya periksa berkas lokal
 *   node scripts/download-pyodide.mjs --source <url>     # sumber lain (boleh diulang)
 *   node scripts/download-pyodide.mjs --version 314.0.7  # ganti versi
 *   node scripts/download-pyodide.mjs --out /tmp/vendor  # ganti folder tujuan
 *
 * Ukuran dan SHA-256 setiap berkas diperiksa setelah diunduh, jadi salinan lokal
 * bisa dipastikan identik dengan rilis resmi.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Versi Pyodide yang dipin (harus sama dengan PYODIDE_VERSION di runner.js). */
const DEFAULT_VERSION = "314.0.7";

/** Berkas minimal yang dibutuhkan Pyodide untuk berjalan di browser. */
const FILES = [
  {
    name: "pyodide.mjs",
    bytes: 17931,
    sha256: "6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109",
  },
  {
    name: "pyodide.asm.mjs",
    bytes: 1250344,
    sha256: "f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635",
  },
  {
    name: "pyodide.asm.wasm",
    bytes: 9598218,
    sha256: "cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6",
  },
  {
    name: "python_stdlib.zip",
    bytes: 2545637,
    sha256: "fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a",
  },
  {
    name: "pyodide-lock.json",
    bytes: 119077,
    sha256: "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010",
  },
];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Membaca argumen baris perintah sederhana (--kunci nilai, atau --flag). */
function parseArgs(argv) {
  const args = { sources: [], verifyOnly: false, force: false, version: DEFAULT_VERSION, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--verify" || arg === "--check") args.verifyOnly = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--source") args.sources.push(argv[++i]);
    else if (arg === "--version") args.version = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--source=")) args.sources.push(arg.slice("--source=".length));
    else if (arg.startsWith("--version=")) args.version = arg.slice("--version=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else throw new Error(`Argumen tidak dikenal: ${arg}`);
  }
  return args;
}

/** Daftar sumber: yang diberikan pemakai, atau CDN resmi (jsDelivr lalu unpkg). */
function buildSources(args) {
  const custom = args.sources.map((url) => ({
    label: url,
    indexURL: url.endsWith("/") ? url : `${url}/`,
  }));
  const resmi = [
    {
      label: "jsDelivr",
      indexURL: `https://cdn.jsdelivr.net/pyodide/v${args.version}/full/`,
    },
    { label: "unpkg", indexURL: `https://unpkg.com/pyodide@${args.version}/` },
  ];
  return custom.length ? custom : resmi;
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Mengunduh satu berkas dari sumber pertama yang berhasil. */
async function downloadFile(file, sources, { force }) {
  const problems = [];
  for (const source of sources) {
    const url = `${source.indexURL}${file.name}`;
    try {
      process.stdout.write(`… ${file.name} dari ${source.label}\n`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength !== file.bytes) {
        throw new Error(`ukuran ${buffer.byteLength} byte, seharusnya ${file.bytes}`);
      }
      const hash = sha256(buffer);
      if (!force && hash !== file.sha256) {
        throw new Error(`SHA-256 berbeda (${hash.slice(0, 12)}…), berkas mungkin berubah`);
      }
      return { buffer, source: source.label, url };
    } catch (error) {
      problems.push(`${source.label}: ${error.message}`);
    }
  }
  throw new Error(`gagal mengunduh ${file.name} — ${problems.join(" | ")}`);
}

/** Memeriksa berkas yang sudah ada di folder tujuan. */
async function verifyExisting(targetDir) {
  let ok = 0;
  for (const file of FILES) {
    const path = join(targetDir, file.name);
    try {
      const berkas = await stat(path);
      const hash = sha256(await readFile(path));
      const cocok = berkas.size === file.bytes && hash === file.sha256;
      console.log(
        `${cocok ? "✅" : "❌"} ${file.name.padEnd(20)} ${berkas.size} byte  sha256 ${hash.slice(0, 12)}…`,
      );
      if (cocok) ok += 1;
    } catch {
      console.log(`❌ ${file.name.padEnd(20)} tidak ada di ${targetDir}`);
    }
  }
  console.log(`\n${ok}/${FILES.length} berkas cocok dengan rilis ${DEFAULT_VERSION}.`);
  return ok === FILES.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Pemakaian: node scripts/download-pyodide.mjs [--verify] [--force] [--version v] [--out dir] [--source url]",
    );
    return 0;
  }

  const targetDir = args.out ? resolve(args.out) : join(REPO_ROOT, "vendor", "pyodide");
  console.log(`Folder tujuan: ${targetDir}`);

  if (args.verifyOnly) {
    const sehat = await verifyExisting(targetDir);
    return sehat ? 0 : 1;
  }

  await mkdir(targetDir, { recursive: true });
  const sources = buildSources(args);

  for (const file of FILES) {
    const { buffer, source, url } = await downloadFile(file, sources, args);
    const path = join(targetDir, file.name);
    const sementara = `${path}.tmp`;
    await writeFile(sementara, buffer);
    await rename(sementara, path); // tulis atomik: tidak meninggalkan berkas separuh
    console.log(
      `✅ ${file.name.padEnd(20)} ${info(buffer.byteLength)} dari ${source} (${url})`,
    );
  }

  console.log(`\nSelesai. Total ${info(FILES.reduce((total, file) => total + file.bytes, 0))}.`);
  console.log("Jalankan `node scripts/download-pyodide.mjs --verify` untuk memeriksa ulang.");
  return 0;
}

/** Format ukuran sederhana untuk laporan. */
function info(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1000000).toFixed(1)} MB`;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nGagal: ${error.message}`);
    console.error(
      "Periksa koneksi internet, atau unduh berkasnya manual dari https://github.com/pyodide/pyodide/releases",
    );
    process.exit(1);
  });
