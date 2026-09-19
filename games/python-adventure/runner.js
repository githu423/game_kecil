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
   Konfigurasi (CDN dipin ke satu versi)
   ----------------------------------------------------------------------------- */

/** Versi Pyodide yang dipin. Jangan diubah tanpa menguji ulang. */
export const PYODIDE_VERSION = "314.0.7";

/** Folder distribusi Pyodide di CDN. */
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Modul loader ESM Pyodide. */
export const PYODIDE_MODULE_URL = `${PYODIDE_INDEX_URL}pyodide.mjs`;

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


def _periksa_arah(arah):
    if arah not in _ARAH_SAH:
        raise ValueError(
            "arah harus 'up', 'down', 'left', atau 'right', bukan " + repr(arah)
        )


def move_up():
    """Naik satu tile (arah hadap menjadi 'up')."""
    __api_move__("up", _inspect.currentframe().f_back.f_lineno)


def move_down():
    """Turun satu tile (arah hadap menjadi 'down')."""
    __api_move__("down", _inspect.currentframe().f_back.f_lineno)


def move_left():
    """Jalan satu tile ke kiri (arah hadap menjadi 'left')."""
    __api_move__("left", _inspect.currentframe().f_back.f_lineno)


def move_right():
    """Jalan satu tile ke kanan (arah hadap menjadi 'right')."""
    __api_move__("right", _inspect.currentframe().f_back.f_lineno)


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
    print("Fungsi yang tersedia: move_up, move_down, move_left, move_right,")
    print("attack(arah=None), is_blocked(arah), can_attack(arah), at_goal(), print(...)")
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
      return null;
    },
    __api_attack__: (direction, line) => {
      guardActionLimit();
      const arah = direction === null || direction === undefined ? engine.facing : direction;
      if (!isValidDirection(arah)) throw new Error(`Arah tidak dikenal: ${arah}`);
      const event = engine.attack(arah);
      event.line = typeof line === "number" ? line : null;
      return null;
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

/** true kalau modul ini sedang dieksekusi sebagai Web Worker (bukan di thread utama). */
const IS_WORKER =
  typeof document === "undefined" &&
  typeof self !== "undefined" &&
  typeof self.postMessage === "function" &&
  typeof self.importScripts === "undefined";

if (IS_WORKER) {
  /** Promise pemuatan Pyodide (lazy: hanya saat permintaan pertama). */
  let pyodidePromise = null;

  function postStatus(stage, message) {
    self.postMessage({ type: "status", stage, message });
  }

  /** Memuat Pyodide dari CDN sekali saja. */
  function ensurePyodide() {
    if (!pyodidePromise) {
      postStatus("loading", "Memuat Python (Pyodide) dari CDN…");
      pyodidePromise = import(/* @vite-ignore */ PYODIDE_MODULE_URL)
        .then((mod) => mod.loadPyodide({ indexURL: PYODIDE_INDEX_URL }))
        .then((pyodide) => {
          postStatus("ready", "Python siap");
          return pyodide;
        })
        .catch((error) => {
          pyodidePromise = null;
          postStatus("error", `Gagal memuat Python: ${error?.message ?? error}`);
          throw error;
        });
    }
    return pyodidePromise;
  }

  /** Menjalankan satu permintaan "run" dari thread utama. */
  async function handleRun(data) {
    const { id, code, grid, facing } = data;
    let hasil;

    try {
      const pyodide = await ensurePyodide();
      hasil = await runPlayerCode(pyodide, {
        code,
        level: { grid, facing },
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
        maxActions: LIMITS.maxActions,
      };
    }

    self.postMessage({ type: "result", id, actions: hasil.events.length, ...hasil });
  }

  self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "init") {
      ensurePyodide().catch(() => {
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
   * @param {{onStatus?:(status:{stage:string, message:string})=>void, onStdout?:(text:string)=>void, workerUrl?:string|URL}} [options]
   */
  constructor(options = {}) {
    this.onStatus = options.onStatus ?? (() => {});
    this.onStdout = options.onStdout ?? (() => {});
    this.workerUrl =
      options.workerUrl ?? new URL(/* @vite-ignore */ "./runner.js", import.meta.url).href;
    this.worker = null;
    this.state = "idle"; // idle | loading | ready | running
    this.readyPromise = null;
    this.pending = null; // { id, resolve, reject, timer }
    this.lastId = 0;
  }

  /** Membuat worker baru dan mulai memuat Pyodide (lazy). */
  ensureReady() {
    if (this.worker && (this.state === "ready" || this.state === "loading")) {
      return this.readyPromise ?? Promise.resolve();
    }

    // Buang worker lama (mis. setelah gagal memuat) supaya tidak menumpuk.
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.worker = new Worker(this.workerUrl, { type: "module" });
    this.worker.addEventListener("message", (event) => this.handleMessage(event.data));
    this.worker.addEventListener("error", (event) => {
      const message = event?.message ?? "Worker Pyodide gagal dimuat";
      this.onStatus({ stage: "error", message });
      this.rejectPending(new Error(message));
    });

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.state = "loading";
    this.onStatus({ stage: "loading", message: "Memuat Python…" });
    this.worker.postMessage({ type: "init" });
    return this.readyPromise;
  }

  /** Menangani pesan dari worker. */
  handleMessage(data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "status") {
      if (data.stage === "ready") {
        this.state = "ready";
        this.readyResolve?.();
      } else if (data.stage === "error") {
        this.state = "idle";
        this.readyReject?.(new Error(data.message));
      }
      this.onStatus({ stage: data.stage, message: data.message });
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
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.state = "idle";
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.rejectPending(new Error("Dihentikan oleh pengguna"));
  }

  /** Membebaskan worker (dipanggil saat halaman ditinggalkan). */
  dispose() {
    this.stop();
  }
}
