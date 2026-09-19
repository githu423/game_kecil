/**
 * runner.js — menjalankan kode Python pemain memakai Pyodide.
 *
 * Modul ini dipakai di DUA tempat (sengaja, supaya tidak ada file tambahan):
 *
 *   1. Sebagai skrip Web Worker:
 *      `new Worker(new URL("./runner.js", import.meta.url), { type: "module" })`
 *      Di dalam worker: memuat Pyodide dari CDN (lazy), menerima perintah "run",
 *      memanggil API game (gerak/serang/sensor) yang mengubah state di engine.js,
 *      lalu mengirim daftar event aksi + output print kembali ke thread utama.
 *
 *   2. Sebagai modul biasa di thread utama: menyediakan kelas `PyodideRunner`
 *      (pembungkus Worker: status, menjalankan kode, batas waktu, tombol Stop).
 *
 * Kode pemain TIDAK PERNAH dieksekusi di thread utama dan tidak pernah memakai eval().
 */

import { GameEngine, isValidDirection } from "./engine.js";

/* -----------------------------------------------------------------------------
   Konfigurasi Pyodide (versi dipin di satu tempat)
   ----------------------------------------------------------------------------- */

/** Versi Pyodide yang dipin. Kalau diubah, jalankan ulang scripts/download-pyodide.mjs. */
export const PYODIDE_VERSION = "314.0.7";

/** Salinan lokal di dalam repo (sumber utama, tidak butuh internet). */
export const PYODIDE_LOCAL_INDEX_URL = new URL("../../vendor/pyodide/", import.meta.url).href;

/** Folder Pyodide di CDN resmi jsDelivr (cadangan pertama). */
export const PYODIDE_CDN_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Folder Pyodide di CDN unpkg (cadangan kedua, isi paket npm yang sama). */
export const PYODIDE_UNPKG_INDEX_URL = `https://unpkg.com/pyodide@${PYODIDE_VERSION}/`;

/**
 * Daftar sumber Pyodide, diurutkan dari yang paling diutamakan.
 * Salinan lokal selalu dicoba lebih dulu; CDN hanya cadangan kalau lokal tidak ada.
 * indexURL harus diakhiri "/" karena Pyodide mencari berkasnya secara relatif.
 */
export const PYODIDE_SOURCES = Object.freeze([
  { id: "lokal", label: "salinan lokal (vendor/pyodide)", indexURL: PYODIDE_LOCAL_INDEX_URL },
  { id: "jsdelivr", label: "CDN jsDelivr", indexURL: PYODIDE_CDN_INDEX_URL },
  { id: "unpkg", label: "CDN unpkg", indexURL: PYODIDE_UNPKG_INDEX_URL },
]);

/** Tetap diekspor untuk kompatibilitas: loader ESM di CDN resmi. */
export const PYODIDE_INDEX_URL = PYODIDE_CDN_INDEX_URL;
export const PYODIDE_MODULE_URL = `${PYODIDE_CDN_INDEX_URL}pyodide.mjs`;

/**
 * Berkas yang diunduh Pyodide dari indexURL. Ukurannya (byte) dipakai untuk
 * menampilkan progres unduhan, mis. "6,1 dari 13,5 MB". Angka ini adalah ukuran
 * asli rilis 314.0.7 (sama untuk salinan lokal maupun CDN).
 */
export const PYODIDE_FILES = Object.freeze([
  { name: "pyodide.asm.wasm", bytes: 9598218 },
  { name: "python_stdlib.zip", bytes: 2545637 },
  { name: "pyodide.asm.mjs", bytes: 1250344 },
  { name: "pyodide-lock.json", bytes: 119077 },
]);

/** Perkiraan total byte yang harus diunduh (dasar persentase progres). */
export const PYODIDE_TOTAL_BYTES = PYODIDE_FILES.reduce((total, file) => total + file.bytes, 0);

/**
 * Batas waktu pemuatan supaya status tidak pernah menggantung selamanya.
 * Kalau terlampaui, UI menampilkan status GAGAL + tombol "Coba lagi".
 */
export const LOAD_LIMITS = Object.freeze({
  totalTimeoutMs: 45000, // total seluruh percobaan (semua sumber)
  stallTimeoutMs: 15000, // dianggap macet kalau tidak ada data masuk selama ini
  readyTimeoutMs: 60000, // pengaman di thread utama kalau worker diam saja
});

/** Memformat byte menjadi teks Indonesia: 4200000 -> "4,2 MB". */
export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1000) return `${Math.round(value)} B`;
  if (value < 1000000) return `${(value / 1000).toFixed(1).replace(".", ",")} kB`;
  return `${(value / 1000000).toFixed(1).replace(".", ",")} MB`;
}

/** Batas eksekusi supaya kode pemain tidak bisa menggantung selamanya. */
export const LIMITS = Object.freeze({
  maxActions: 500, // maksimal aksi (gerak + serang) per sekali Run
  timeoutMs: 5000, // batas waktu di thread utama
  maxOutputLines: 200, // batas baris output print
});

/* -----------------------------------------------------------------------------
   Fungsi Python yang tersedia untuk pemain
   ----------------------------------------------------------------------------- */

/**
 * Prelude Python: mendefinisikan move_*, attack(), sensor, dan print.
 * Setiap fungsi memakai `_inspect.currentframe().f_back.f_lineno` supaya nomor
 * baris kode pemain bisa dicatat pada tiap event (untuk sorotan baris saat animasi).
 */
export const PYTHON_PRELUDE = `# --- Fungsi bawaan Python Adventure (dibuat otomatis) ---
import builtins as _builtins
import inspect as _inspect

_ARAH_SAH = ("up", "down", "left", "right")
_MAKS_LANGKAH = 50


class ArgumenError(Exception):
    """Argumen perintah tidak sesuai, mis. move_down(0) atau move_down("dua")."""


def _periksa_arah(arah):
    if arah not in _ARAH_SAH:
        raise ValueError(
            "arah harus 'up', 'down', 'left', atau 'right', bukan " + repr(arah)
        )


def _periksa_langkah(langkah, nama):
    """Jumlah langkah harus bilangan bulat 1 sampai _MAKS_LANGKAH."""
    if isinstance(langkah, bool) or not isinstance(langkah, int):
        raise ArgumenError(
            "Jumlah langkah pada " + nama + "() harus bilangan bulat, contoh: " + nama + "(2)."
        )
    if langkah < 1:
        raise ArgumenError(
            "Jumlah langkah pada " + nama + "() minimal 1, contoh: " + nama + "(1)."
        )
    if langkah > _MAKS_LANGKAH:
        raise ArgumenError(
            "Jumlah langkah pada " + nama + "() maksimal " + str(_MAKS_LANGKAH) + " per perintah."
        )
    return langkah


def _gerak(arah, langkah, nama, baris):
    """Melangkah "langkah" kali satu tile; berhenti kalau tertabrak."""
    _periksa_langkah(langkah, nama)
    for _ in range(langkah):
        if not __api_move__(arah, baris):
            break


def move_up(langkah=1):
    """Naik "langkah" tile (default 1). Contoh: move_up() atau move_up(2)."""
    _gerak("up", langkah, "move_up", _inspect.currentframe().f_back.f_lineno)


def move_down(langkah=1):
    """Turun "langkah" tile (default 1). Contoh: move_down() atau move_down(2)."""
    _gerak("down", langkah, "move_down", _inspect.currentframe().f_back.f_lineno)


def move_left(langkah=1):
    """Jalan "langkah" tile ke kiri (default 1)."""
    _gerak("left", langkah, "move_left", _inspect.currentframe().f_back.f_lineno)


def move_right(langkah=1):
    """Jalan "langkah" tile ke kanan (default 1)."""
    _gerak("right", langkah, "move_right", _inspect.currentframe().f_back.f_lineno)


def attack(arah=None):
    """Serang tile di depan arah hadap terakhir (atau arah yang diberikan).

    Contoh: attack()  -> memakai arah hadap terakhir
            attack("right") -> menyerang tile sebelah kanan
    """
    if arah is not None:
        _periksa_arah(arah)
    __api_attack__(arah, _inspect.currentframe().f_back.f_lineno)


def is_blocked(arah):
    """True kalau tile di arah itu tidak bisa dilewati. Contoh: is_blocked("right")"""
    _periksa_arah(arah)
    return bool(__api_is_blocked__(arah))


def can_attack(arah):
    """True kalau tile di arah itu batu yang bisa dihancurkan."""
    _periksa_arah(arah)
    return bool(__api_can_attack__(arah))


def at_goal():
    """True kalau karakter sudah berdiri di tile tujuan."""
    return bool(__api_at_goal__())


def print(*nilai, sep=" ", end="\\n"):
    """Menampilkan teks di panel Output."""
    __api_output__(sep.join(str(n) for n in nilai) + end)


def input(prompt=""):
    """Tidak tersedia: game ini tidak menerima ketikan saat kode berjalan."""
    raise RuntimeError(
        "input() tidak tersedia di Python Adventure. Gunakan variabel atau angka langsung."
    )


def bantuan():
    """Menampilkan daftar fungsi yang bisa dipakai."""
    print("Fungsi yang tersedia:")
    print("  move_up(), move_down(), move_left(), move_right()  -> jalan 1 tile")
    print("  move_down(2)  -> jalan 2 tile sekaligus (angka 1 sampai 50)")
    print("  attack(arah=None)  -> hancurkan batu di depan arah hadap terakhir")
    print("  is_blocked(arah), can_attack(arah), at_goal(), print(...)")
`;

/* -----------------------------------------------------------------------------
   Penerjemah pesan error Python → Bahasa Indonesia
   ----------------------------------------------------------------------------- */

/** Daftar nama fungsi yang dipakai untuk mengusulkan perbaikan salah ketik. */
const KNOWN_NAMES = [
  "move_up",
  "move_down",
  "move_left",
  "move_right",
  "attack",
  "is_blocked",
  "can_attack",
  "at_goal",
  "print",
  "range",
  "len",
];

/** Jarak edit sederhana (Levenshtein) untuk saran nama fungsi. */
function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, (_, i) => [i, ...new Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j += 1) table[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost);
    }
  }
  return table[rows - 1][cols - 1];
}

/** Mengusulkan nama fungsi yang mirip (kalau ada). */
export function suggestName(name) {
  let best = null;
  for (const candidate of KNOWN_NAMES) {
    const distance = editDistance(String(name).toLowerCase(), candidate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best ? best.candidate : null;
}

const FRIENDLY_BY_TYPE = {
  SyntaxError: (info) =>
    `Ada kesalahan penulisan (sintaks) di baris ${info.line ?? "?"}. Cek tanda kurung, tanda titik dua (:), dan indentasi.`,
  IndentationError: (info) =>
    `Indentasi belum benar di baris ${info.line ?? "?"}. Baris di dalam for/if/while/def harus masuk 4 spasi lebih dalam.`,
  TabError: () =>
    "Jangan mencampur Tab dan spasi. Gunakan spasi (tombol Tab di editor sudah otomatis menjadi 4 spasi).",
  NameError: (info) =>
    `Nama "${info.name ?? "?"}" belum dikenal. Cek ejaan nama fungsi/variabel${info.suggestion ? `, mungkin maksudmu ${info.suggestion}()` : ""}.`,
  UnboundLocalError: (info) =>
    `Variabel "${info.name ?? "?"}" dipakai sebelum diisi nilainya. Beri nilai dulu sebelum dipakai.`,
  TypeError: (info) =>
    `Cara memakai fungsi/perintah itu belum tepat. ${info.detail ?? ""}`.trim(),
  ValueError: (info) => info.detail || "Nilainya tidak sesuai untuk perintah itu.",
  ZeroDivisionError: () => "Tidak bisa membagi dengan nol.",
  IndexError: () => "Urutan (list) yang diakses di luar jangkauan. Cek indeksnya.",
  KeyError: () => "Kunci yang dicari tidak ada di dalam dictionary.",
  AttributeError: (info) =>
    `Objek itu tidak punya bagian bernama "${info.name ?? "?"}". Cek ejaannya.`,
  ModuleNotFoundError: (info) =>
    `Modul "${info.name ?? "?"}" tidak tersedia di sini. Hanya pustaka standar Python yang bisa dipakai.`,
  ImportError: (info) =>
    `Gagal mengimpor "${info.name ?? "?"}". Hanya pustaka standar Python yang tersedia.`,
  RecursionError: () =>
    "Fungsi memanggil dirinya sendiri terlalu dalam. Tambahkan syarat berhenti di dalam def.",
  RuntimeError: (info) => info.detail || "Terjadi kesalahan saat kode berjalan.",
  ArgumenError: (info) =>
    info.detail || "Argumen perintah belum tepat. Cek angkanya, mis. move_down(2).",
  JsException: (info) =>
    info.detail?.includes("batas aksi")
      ? `Kodemu sudah melakukan lebih dari ${LIMITS.maxActions} aksi. Coba pakai perulangan atau rute yang lebih pendek.`
      : "Kode berhenti karena perintah yang tidak dikenal.",
};

/**
 * Menerjemahkan error Python menjadi pesan ramah + nomor baris.
 * @param {string} message pesan asli dari Pyodide (berisi traceback)
 * @returns {{type:string, line:number|null, friendly:string, technical:string}}
 */
export function parsePythonError(message) {
  const technical = String(message ?? "").trim();
  const lines = technical.split("\n");

  // Baris terakhir biasanya: "TipeError: penjelasan"
  let lastMeaningful = "";
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) {
      lastMeaningful = lines[i].trim();
      break;
    }
  }
  const typeMatch = /^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Interrupt|Exit))\s*:?\s*(.*)$/.exec(
    lastMeaningful,
  );
  const rawType = typeMatch ? typeMatch[1].split(".").pop() : "Error";
  const detail = typeMatch ? typeMatch[2].trim() : lastMeaningful;

  // Nomor baris: ambil frame terakhir milik kode pemain.
  let line = null;
  const framePattern = /File "(?:<kodemu>|<exec>)"[^\n]*?, line (\d+)/g;
  let frameMatch;
  while ((frameMatch = framePattern.exec(technical)) !== null) {
    line = Number(frameMatch[1]);
  }
  if (line === null) {
    const bareLine = /File "<(?:kodemu|exec)>", line (\d+)$/m.exec(technical);
    if (bareLine) line = Number(bareLine[1]);
  }

  const nameMatch = /name '([^']+)'/.exec(detail);
  const info = {
    line,
    detail,
    name: nameMatch ? nameMatch[1] : null,
  };
  if (rawType === "NameError" && info.name) info.suggestion = suggestName(info.name);

  const builder = FRIENDLY_BY_TYPE[rawType];
  const friendly = builder
    ? builder(info)
    : `Terjadi kesalahan: ${detail || rawType}. Baca traceback teknis di bawah untuk detail.`;

  return { type: rawType, line, friendly, technical };
}

/* -----------------------------------------------------------------------------
   BAGIAN 1 — mesin eksekusi (dipakai worker, dan bisa diuji dari Node/tests.html)
   ----------------------------------------------------------------------------- */

/**
 * Membuat jembatan API game yang dipanggil dari Python.
 * Setiap aksi (gerak/serang) langsung mengubah state di engine.js dan merekam event.
 *
 * @param {GameEngine} engine
 * @param {{onOutput?:(text:string)=>void, maxActions?:number}} [options]
 */
export function createGameApi(engine, options = {}) {
  const maxActions = options.maxActions ?? LIMITS.maxActions;
  const onOutput = options.onOutput ?? (() => {});
  const outputLines = [];
  let truncated = false;

  /** Simpan + teruskan teks print (dibatasi supaya tidak membanjiri UI). */
  const pushOutput = (text) => {
    if (outputLines.length >= LIMITS.maxOutputLines) {
      truncated = true;
      return;
    }
    outputLines.push(text);
    onOutput(String(text));
  };

  /** Batas aksi: hentikan kode pemain dengan error yang jelas (bukan crash). */
  const guardActionLimit = () => {
    if (engine.actionCount >= maxActions) {
      throw new Error("batas aksi");
    }
  };

  const api = {
    __api_move__: (direction, line) => {
      guardActionLimit();
      if (!isValidDirection(direction)) throw new Error(`Arah tidak dikenal: ${direction}`);
      const event = engine.move(direction);
      event.line = typeof line === "number" ? line : null;
      // True kalau berhasil: dipakai prelude untuk berhenti saat tertabrak.
      return Boolean(event.ok);
    },
    __api_attack__: (direction, line) => {
      guardActionLimit();
      const arah = direction === null || direction === undefined ? engine.facing : direction;
      if (!isValidDirection(arah)) throw new Error(`Arah tidak dikenal: ${arah}`);
      const event = engine.attack(arah);
      event.line = typeof line === "number" ? line : null;
      return Boolean(event.ok);
    },
    __api_is_blocked__: (direction) => engine.isBlocked(direction),
    __api_can_attack__: (direction) => engine.canAttack(direction),
    __api_at_goal__: () => engine.atGoal(),
    __api_output__: (text) => {
      pushOutput(text);
      return null;
    },
  };

  return {
    api,
    getOutput: () => outputLines.join(""),
    isTruncated: () => truncated,
  };
}

/**
 * Menjalankan kode pemain sekali: reset state level, jalankan Python dengan cepat,
 * kumpulkan event aksi + output, lalu kembalikan hasilnya.
 *
 * Kode pemain TIDAK menyentuh DOM: semua efeknya lewat API di atas.
 *
 * @param {object} pyodide instance Pyodide yang sudah dimuat
 * @param {{code:string, level:{grid:string[], facing?:string}, onOutput?:(text:string)=>void, maxActions?:number}} params
 */
export async function runPlayerCode(pyodide, params) {
  const { code, level, onOutput, maxActions } = params;
  const engine = new GameEngine({ grid: level.grid, facing: level.facing });
  const bridge = createGameApi(engine, { onOutput, maxActions });

  let error = null;
  let limitHit = false;
  const startedAt = Date.now();

  try {
    const dictFactory = pyodide.globals.get("dict");
    const globals = dictFactory();
    for (const [name, fn] of Object.entries(bridge.api)) globals.set(name, fn);

    try {
      await pyodide.runPythonAsync(PYTHON_PRELUDE, { globals, filename: "<sistem>" });
      await pyodide.runPythonAsync(code, { globals, filename: "<kodemu>" });
    } catch (pythonFailure) {
      const message = String(pythonFailure?.message ?? pythonFailure);
      limitHit = message.includes("batas aksi");
      error = { kind: limitHit ? "action-limit" : "python", message };
    }
  } catch (fatalFailure) {
    error = { kind: "pyodide", message: String(fatalFailure?.message ?? fatalFailure) };
  }

  return {
    ok: !error,
    error,
    events: engine.events,
    output: bridge.getOutput(),
    truncated: bridge.isTruncated(),
    reachedGoal: engine.atGoal(),
    actionCount: engine.actionCount,
    coins: engine.coins,
    keys: engine.keys,
    elapsedMs: Date.now() - startedAt,
    maxActions: maxActions ?? LIMITS.maxActions,
  };
}

/* -----------------------------------------------------------------------------
   BAGIAN 2 — kode yang berjalan DI DALAM Web Worker
   ----------------------------------------------------------------------------- */

/* -----------------------------------------------------------------------------
   BAGIAN 1B — pemuat Pyodide (dipakai worker; bisa diuji juga dari Node)
   ----------------------------------------------------------------------------- */

/** Error pemuatan Pyodide yang membawa rincian tiap sumber (untuk panel teknis). */
export class PyodideLoadError extends Error {
  /**
   * @param {string} message pesan ringkas
   * @param {Array<{id:string,label:string,ok:boolean,ms:number,error?:string}>} attempts
   */
  constructor(message, attempts = []) {
    super(message);
    this.name = "PyodideLoadError";
    this.attempts = attempts;
  }

  /** Ringkasan rincian tiap sumber, satu baris per sumber. */
  technicalReport() {
    if (!this.attempts.length) return String(this.message);
    return this.attempts
      .map((a) => `- ${a.label}: ${a.ok ? "berhasil" : (a.error ?? "gagal")} (${a.ms} ms)`)
      .join("\n");
  }
}

/**
 * Mengunduh satu berkas sambil melaporkan jumlah byte yang masuk.
 * Unduhan ini juga menghangatkan cache browser, sehingga pemanggilan berkas
 * yang sama oleh Pyodide sesudahnya tidak perlu mengunduh ulang.
 */
export async function fetchWithProgress(url, options = {}) {
  const { signal, onBytes = () => {}, fetchImpl = fetch } = options;
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} saat meminta ${url}`);

  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    onBytes(buffer.byteLength);
    return buffer.byteLength;
  }

  const reader = response.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes = value?.byteLength ?? 0;
    received += bytes;
    onBytes(bytes);
  }
  return received;
}

/** true kalau modul ini berjalan di Node.js (dipakai skrip pengujian di scripts/). */
const IS_NODE = typeof process !== "undefined" && Boolean(process.versions?.node);

/**
 * Pyodide di Node.js memakai jalur berkas biasa, bukan URL "file://".
 * Di browser fungsi ini tidak mengubah apa pun.
 */
function toLoadIndexURL(indexURL) {
  if (!IS_NODE || !indexURL.startsWith("file://")) return indexURL;
  return decodeURIComponent(new URL(indexURL).pathname);
}

/** Mengunduh berkas-berkas Pyodide dari satu sumber (untuk progres unduhan). */
export async function prefetchSource(source, options = {}) {
  const { onProgress = () => {}, onBytes, signal, fetchImpl = fetch } = options;
  let receivedTotal = 0;
  for (const file of PYODIDE_FILES) {
    await fetchWithProgress(new URL(file.name, source.indexURL).href, {
      signal,
      fetchImpl,
      onBytes: (bytes) => {
        receivedTotal += bytes;
        onProgress({ received: receivedTotal, total: PYODIDE_TOTAL_BYTES, file: file.name });
        onBytes?.(receivedTotal);
      },
    });
  }
  return receivedTotal;
}

/**
 * Memuat instance Pyodide dari satu sumber.
 *
 * Ada dua pengaman waktu: (1) "macet" — tidak ada byte masuk selama
 * LOAD_LIMITS.stallTimeoutMs, lalu koneksi dibatalkan; (2) batas waktu total
 * (default 45 detik) yang membatalkan seluruh percobaan sumber ini.
 *
 * @param {{id:string,label:string,indexURL:string}} source
 */
export async function loadPyodideFromSource(source, options = {}) {
  const {
    onProgress = () => {},
    onStage = () => {},
    importModule = (url) => import(/* @vite-ignore */ url),
    stallTimeoutMs = LOAD_LIMITS.stallTimeoutMs,
    timeoutMs = LOAD_LIMITS.totalTimeoutMs,
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  let stallTimer = null;
  let totalTimer = null;

  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      controller.abort(new Error(`Tidak ada data masuk selama ${stallTimeoutMs / 1000} detik`));
    }, stallTimeoutMs);
  };

  const work = async () => {
    onStage("download", `Mengunduh Python dari ${source.label}…`);
    resetStall();
    await prefetchSource(source, {
      onProgress,
      onBytes: resetStall,
      signal: controller.signal,
      fetchImpl,
    });
    if (stallTimer) clearTimeout(stallTimer);

    onStage("start", "Menyiapkan Python (sekali saja, mohon tunggu)…");
    const mod = await importModule(`${source.indexURL}pyodide.mjs`);
    const load = mod.loadPyodide ?? mod.default?.loadPyodide;
    if (typeof load !== "function") {
      throw new Error("Berkas pyodide.mjs tidak berisi fungsi loadPyodide");
    }
    return load({ indexURL: toLoadIndexURL(source.indexURL) });
  };

  const timeout = new Promise((_, reject) => {
    totalTimer = setTimeout(() => {
      controller.abort(new Error("Batas waktu pemuatan terlampaui"));
      reject(new Error(`Batas waktu ${Math.round(timeoutMs / 1000)} detik terlampaui`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    if (totalTimer) clearTimeout(totalTimer);
  }
}

/**
 * Memuat Pyodide dari sumber pertama yang berhasil: salinan lokal dulu,
 * baru CDN sebagai cadangan.
 *
 * @returns {Promise<{pyodide:object, source:object, attempts:Array}>}
 * @throws {PyodideLoadError} kalau semua sumber gagal
 */
export async function loadPyodideWithFallback(options = {}) {
  const {
    sources = PYODIDE_SOURCES,
    skip = [],
    onProgress = () => {},
    onStatus = () => {},
    importModule,
    fetchImpl = fetch,
    timeoutMs = LOAD_LIMITS.totalTimeoutMs,
    stallTimeoutMs = LOAD_LIMITS.stallTimeoutMs,
    now = () => Date.now(),
  } = options;

  const deadline = now() + timeoutMs;
  const attempts = [];
  const daftarSumber = sources.filter((source) => !skip.includes(source.id));

  for (const source of daftarSumber) {
    const mulai = now();
    const sisa = deadline - mulai;
    if (sisa <= 500) {
      attempts.push({
        id: source.id,
        label: source.label,
        ok: false,
        ms: 0,
        error: "Batas waktu total habis sebelum sumber ini dicoba",
      });
      continue;
    }

    try {
      const pyodide = await loadPyodideFromSource(source, {
        onProgress: (info) => onProgress({ ...info, source }),
        onStage: (stage, message) => onStatus(stage, message, source),
        importModule,
        fetchImpl,
        timeoutMs: sisa,
        stallTimeoutMs,
      });
      attempts.push({ id: source.id, label: source.label, ok: true, ms: now() - mulai });
      return { pyodide, source, attempts };
    } catch (error) {
      const pesan = String(error?.message ?? error);
      attempts.push({ id: source.id, label: source.label, ok: false, ms: now() - mulai, error: pesan });
      onStatus("loading", `Gagal dari ${source.label} (${pesan}). Mencoba sumber berikutnya…`, source);
    }
  }

  const ringkas = attempts.length
    ? `Semua sumber Python gagal — ${attempts.map((a) => `${a.label}: ${a.ok ? "berhasil" : a.error}`).join(" | ")}`
    : "Tidak ada sumber Python yang bisa dicoba";
  throw new PyodideLoadError(ringkas, attempts);
}

/** true kalau modul ini sedang dieksekusi sebagai Web Worker (bukan di thread utama). */
const IS_WORKER =
  typeof document === "undefined" &&
  typeof self !== "undefined" &&
  typeof self.postMessage === "function" &&
  typeof self.importScripts === "undefined";

if (IS_WORKER) {
  /** Promise pemuatan Pyodide (lazy: hanya saat permintaan pertama). */
  let pyodidePromise = null;
  /** Sumber yang sudah terbukti gagal, tidak dicoba lagi saat "Coba lagi". */
  let failedSourceIds = [];

  function postStatus(stage, message, extra = {}) {
    self.postMessage({ type: "status", stage, message, ...extra });
  }

  /** Memuat Pyodide sekali saja, sambil melaporkan progres ke thread utama. */
  function ensurePyodide(skip = []) {
    if (pyodidePromise) return pyodidePromise;

    const lewati = Array.from(new Set([...(skip ?? []), ...failedSourceIds]));
    postStatus("loading", "Menyiapkan Python…", {
      progress: { received: 0, total: PYODIDE_TOTAL_BYTES, percent: 0 },
    });

    pyodidePromise = loadPyodideWithFallback({
      skip: lewati,
      onStatus: (stage, message, source) =>
        postStatus("loading", message, { source: source.id, sourceLabel: source.label }),
      onProgress: ({ received, total, source }) => {
        const percent = total ? Math.min(99, Math.round((received / total) * 100)) : 0;
        postStatus(
          "loading",
          `Mengunduh Python… ${formatBytes(received)} dari ${formatBytes(total)} (${percent}%)`,
          {
            progress: { received, total, percent },
            source: source.id,
            sourceLabel: source.label,
          },
        );
      },
    })
      .then(({ pyodide, source, attempts }) => {
        postStatus("ready", `Python siap (${source.label})`, {
          source: source.id,
          sourceLabel: source.label,
          attempts,
        });
        return pyodide;
      })
      .catch((error) => {
        pyodidePromise = null;
        const attempts = error?.attempts ?? [];
        failedSourceIds = attempts.filter((a) => !a.ok).map((a) => a.id);
        postStatus("error", "Python gagal dimuat.", {
          failedSources: failedSourceIds,
          technical:
            error instanceof PyodideLoadError
              ? error.technicalReport()
              : String(error?.stack ?? error?.message ?? error),
        });
        throw error;
      });

    return pyodidePromise;
  }

  /** Menjalankan satu permintaan "run" dari thread utama. */
  async function handleRun(data) {
    const { id, code, grid, facing, maxActions } = data;
    let hasil;

    try {
      const pyodide = await ensurePyodide();
      hasil = await runPlayerCode(pyodide, {
        code,
        level: { grid, facing },
        maxActions,
        onOutput: (text) => self.postMessage({ type: "stdout", text }),
      });
    } catch (fatalError) {
      hasil = {
        ok: false,
        error: { kind: "pyodide", message: String(fatalError?.message ?? fatalError) },
        events: [],
        output: "",
        truncated: false,
        reachedGoal: false,
        actionCount: 0,
        coins: 0,
        keys: 0,
        elapsedMs: 0,
        maxActions: maxActions ?? LIMITS.maxActions,
      };
    }

    self.postMessage({ type: "result", id, actions: hasil.events.length, ...hasil });
  }

  self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "init") {
      ensurePyodide(Array.isArray(data.skip) ? data.skip : []).catch(() => {
        /* kegagalan sudah dilaporkan lewat pesan status */
      });
      return;
    }

    if (data.type === "run") {
      handleRun(data).catch((fatalError) => {
        self.postMessage({
          type: "result",
          id: data.id,
          ok: false,
          error: { kind: "internal", message: String(fatalError?.message ?? fatalError) },
          events: [],
          output: "",
          truncated: false,
          reachedGoal: false,
          actionCount: 0,
          coins: 0,
          keys: 0,
          elapsedMs: 0,
          actions: 0,
          maxActions: LIMITS.maxActions,
        });
      });
    }
  });
}

/* -----------------------------------------------------------------------------
   BAGIAN 2 — pembungkus Worker untuk thread utama
   ----------------------------------------------------------------------------- */

/** Error khusus saat kode pemain melewati batas waktu. */
export class TimeoutError extends Error {
  constructor(message = "Kode berjalan terlalu lama") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Pembungkus Web Worker Pyodide.
 *
 * contoh:
 *   const runner = new PyodideRunner({ onStatus: (s) => console.log(s) });
 *   const hasil = await runner.run("move_right()", level.grid);
 */
export class PyodideRunner {
  /**
   * @param {{onStatus?:(status:object)=>void, onStdout?:(text:string)=>void, workerUrl?:string|URL, loadTimeoutMs?:number}} [options]
   */
  constructor(options = {}) {
    this.onStatus = options.onStatus ?? (() => {});
    this.onStdout = options.onStdout ?? (() => {});
    this.workerUrl =
      options.workerUrl ?? new URL(/* @vite-ignore */ "./runner.js", import.meta.url).href;
    this.worker = null;
    this.state = "idle"; // idle | loading | ready | running | error
    this.readyPromise = null;
    this.pending = null; // { id, resolve, reject, timer }
    this.lastId = 0;
    this.loadTimer = null; // pengaman kalau worker diam saja
    this.loadTimeoutMs = options.loadTimeoutMs ?? LOAD_LIMITS.readyTimeoutMs; // bisa diperpendek saat pengujian
    this.failedSources = []; // sumber yang sudah gagal (dilewati saat "Coba lagi")
    this.progress = null; // progres unduhan terakhir
    this.activeSource = null; // keterangan sumber yang sedang/berhasil dipakai
  }

  /** Membuat worker baru dan mulai memuat Pyodide (lazy). */
  ensureReady() {
    if (this.worker && (this.state === "ready" || this.state === "loading")) {
      return this.readyPromise ?? Promise.resolve();
    }

    // Buang worker lama (mis. setelah gagal memuat) supaya tidak menumpuk.
    this.disposeWorker();

    try {
      this.worker = new Worker(this.workerUrl, { type: "module" });
    } catch (error) {
      const pesan = `Worker tidak bisa dibuat: ${error?.message ?? error}`;
      this.state = "error";
      this.onStatus({ stage: "error", message: pesan, technical: String(error?.stack ?? error) });
      this.readyPromise = Promise.reject(new Error(pesan));
      return this.readyPromise;
    }

    this.worker.addEventListener("message", (event) => this.handleMessage(event.data));
    this.worker.addEventListener("error", (event) => {
      const message = event?.message ?? "Worker Pyodide gagal dimuat";
      this.failLoad(
        message,
        `Error di worker: ${message}\nBerkas: ${event?.filename ?? "?"} baris ${event?.lineno ?? "?"}`,
      );
    });
    this.worker.addEventListener("messageerror", () => {
      this.failLoad(
        "Pesan dari worker tidak bisa dibaca.",
        "Terjadi messageerror: data yang dikirim worker bukan struktur yang dikenali.",
      );
    });

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Kegagalan selalu dilaporkan lewat onStatus(); catch kosong ini mencegah
    // "unhandled rejection" kalau pemanggil tidak memasang .catch().
    this.readyPromise.catch(() => {});
    this.state = "loading";
    this.progress = { received: 0, total: PYODIDE_TOTAL_BYTES, percent: 0 };
    this.onStatus({
      stage: "loading",
      message: "Menyiapkan Python…",
      progress: this.progress,
      sourceLabel: null,
    });

    // Pengaman terakhir: kalau worker tidak pernah menjawab, jangan menggantung.
    this.loadTimer = setTimeout(() => {
      this.failLoad(
        `Worker tidak merespons setelah ${Math.round(this.loadTimeoutMs / 1000)} detik.`,
        "Worker Pyodide tidak mengirim pesan apa pun (skrip worker mungkin gagal dimuat).",
      );
    }, this.loadTimeoutMs);

    this.worker.postMessage({ type: "init", skip: this.failedSources });
    return this.readyPromise;
  }

  /** Menandai pemuatan gagal: bersihkan worker, kabari UI, tolak promise. */
  failLoad(message, technical = "") {
    if (this.state === "ready" || this.state === "running") return;
    this.clearLoadTimer();
    this.state = "error";
    this.onStatus({ stage: "error", message, technical });
    this.rejectPending(new Error(message));
    this.disposeWorker();
    this.readyReject?.(new Error(message));
    this.readyResolve = null;
    this.readyReject = null;
  }

  /** Membuang worker tanpa mengubah status (dipakai saat gagal/retry). */
  disposeWorker() {
    this.clearLoadTimer();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  clearLoadTimer() {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  /**
   * Memulai ulang dari nol: buang worker lama, lalu muat Pyodide lagi.
   * Sumber yang sudah terbukti gagal dilewati supaya percobaan berikutnya
   * langsung memakai sumber lain (kalau semua gagal, daftarnya direset).
   */
  retry() {
    const semuaGagal = this.failedSources.length >= PYODIDE_SOURCES.length;
    this.disposeWorker();
    this.state = "idle";
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    if (semuaGagal) this.failedSources = [];
    return this.ensureReady();
  }

  /** Menangani pesan dari worker. */
  handleMessage(data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "status") {
      if (data.stage === "ready") {
        this.clearLoadTimer();
        this.state = "ready";
        this.activeSource = data.sourceLabel ?? null;
        this.progress = { received: PYODIDE_TOTAL_BYTES, total: PYODIDE_TOTAL_BYTES, percent: 100 };
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
      } else if (data.stage === "error") {
        this.clearLoadTimer();
        this.state = "error";
        if (Array.isArray(data.failedSources)) this.failedSources = data.failedSources;
        this.disposeWorker();
        this.readyReject?.(new Error(data.message));
        this.readyResolve = null;
        this.readyReject = null;
      } else if (data.progress) {
        this.progress = data.progress;
      }
      this.onStatus({
        stage: data.stage,
        message: data.message,
        progress: data.progress ?? this.progress,
        sourceLabel: data.sourceLabel ?? this.activeSource,
        technical: data.technical ?? "",
      });
      return;
    }

    if (data.type === "stdout") {
      this.onStdout(String(data.text ?? ""));
      return;
    }

    if (data.type === "result") {
      const pending = this.pending;
      if (!pending || pending.id !== data.id) return;
      clearTimeout(pending.timer);
      this.pending = null;
      this.state = "ready";
      pending.resolve(data);
      return;
    }
  }

  /** Menolak permintaan yang sedang berjalan (setelah Stop/timeout). */
  rejectPending(error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const { reject } = this.pending;
    this.pending = null;
    reject(error);
  }

  /**
   * Menjalankan kode Python pemain.
   * @param {string} code
   * @param {{grid:string[], facing?:string}} level
   * @returns {Promise<object>} hasil dari worker
   */
  async run(code, level) {
    await this.ensureReady();
    if (this.pending) throw new Error("Masih ada kode yang berjalan.");

    const id = ++this.lastId;
    this.state = "running";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(new TimeoutError());
        this.stop(); // buang worker yang macet; worker baru dibuat saat Run berikutnya
      }, LIMITS.timeoutMs);

      this.pending = { id, resolve, reject, timer };
      this.worker.postMessage({
        type: "run",
        id,
        code,
        grid: level.grid,
        facing: level.facing,
      });
    });
  }

  /** Menghentikan worker (dipakai tombol Stop dan saat batas waktu terlampaui). */
  stop() {
    this.disposeWorker();
    this.state = "idle";
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.progress = null;
    this.rejectPending(new Error("Dihentikan oleh pengguna"));
  }

  /** Membebaskan worker (dipanggil saat halaman ditinggalkan). */
  dispose() {
    this.stop();
  }
}
