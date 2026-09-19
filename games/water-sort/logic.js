/**
 * logic.js — aturan main Water Sort, murni tanpa DOM.
 *
 * Model data:
 *   - Botol disimpan sebagai array warna dari BAWAH ke ATAS.
 *     Contoh: ["merah","biru","biru","hijau"] berarti paling bawah merah.
 *   - Satu state = { bottles: string[][], moves: number }.
 *   - Kapasitas botol selalu 4 (CAPACITY) dan setiap warna selalu berjumlah 4 lapis.
 *
 * Aturan penuangan:
 *   - Sumber tidak boleh kosong, tujuan tidak boleh penuh.
 *   - Tujuan harus kosong atau warna teratasnya sama dengan warna teratas sumber.
 *   - Yang dituang adalah seluruh segmen warna yang sama dari atas, sebanyak
 *     ruang yang tersedia di tujuan.
 */

/** Kapasitas satu botol (4 lapis). */
export const CAPACITY = 4;

/**
 * Daftar warna yang dipakai level. `symbol` dipakai untuk Mode aksesibel
 * (pemain yang sulit membedakan warna), `pattern` menambah pola garis.
 */
export const COLORS = Object.freeze([
  { id: "merah", label: "Merah", hex: "#e5484d", symbol: "●", pattern: "solid" },
  { id: "biru", label: "Biru", hex: "#2563eb", symbol: "▲", pattern: "solid" },
  { id: "kuning", label: "Kuning", hex: "#eab308", symbol: "■", pattern: "solid" },
  { id: "hijau", label: "Hijau", hex: "#16a34a", symbol: "◆", pattern: "solid" },
  { id: "ungu", label: "Ungu", hex: "#8b5cf6", symbol: "★", pattern: "solid" },
  { id: "oranye", label: "Oranye", hex: "#f97316", symbol: "✚", pattern: "solid" },
  { id: "toska", label: "Toska", hex: "#06b6d4", symbol: "✱", pattern: "diagonal" },
  { id: "merah-muda", label: "Merah muda", hex: "#ec4899", symbol: "♥", pattern: "solid" },
  { id: "cokelat", label: "Cokelat", hex: "#92400e", symbol: "▼", pattern: "diagonal" },
  { id: "abu", label: "Abu-abu", hex: "#64748b", symbol: "◇", pattern: "solid" },
  { id: "hijau-muda", label: "Hijau muda", hex: "#84cc16", symbol: "✦", pattern: "diagonal" },
  { id: "biru-tua", label: "Biru tua", hex: "#1e3a8a", symbol: "⬟", pattern: "solid" },
]);

const COLOR_BY_ID = new Map(COLORS.map((color) => [color.id, color]));

/** Info warna (label/hex/symbol). Mengembalikan info netral kalau tidak dikenal. */
export function colorInfo(id) {
  return (
    COLOR_BY_ID.get(id) ?? { id, label: String(id), hex: "#9ca3af", symbol: "?", pattern: "solid" }
  );
}

/* -----------------------------------------------------------------------------
   Membaca & menyalin state
   ----------------------------------------------------------------------------- */

/** Menyalin daftar botol (deep copy) supaya state lama tidak ikut berubah. */
function cloneBottles(bottles) {
  return bottles.map((bottle) => bottle.slice());
}

/** Membuat state baru dari daftar botol. */
export function createState(bottles) {
  return { bottles: cloneBottles(bottles), moves: 0 };
}

/** Menyalin state. */
export function cloneState(state) {
  return { bottles: cloneBottles(state.bottles), moves: state.moves ?? 0 };
}

/** Warna paling atas botol (null kalau kosong). */
export function topColor(bottle) {
  return bottle.length ? bottle[bottle.length - 1] : null;
}

/** Berapa lapis warna yang sama di atas botol. */
export function topRun(bottle) {
  if (!bottle.length) return 0;
  const color = topColor(bottle);
  let count = 0;
  for (let i = bottle.length - 1; i >= 0 && bottle[i] === color; i -= 1) count += 1;
  return count;
}

/** Sisa ruang botol. */
export function freeSpace(bottle) {
  return CAPACITY - bottle.length;
}

/** Botol sudah selesai: kosong atau penuh satu warna. */
export function isBottleDone(bottle) {
  if (bottle.length === 0) return true;
  return bottle.length === CAPACITY && bottle.every((color) => color === bottle[0]);
}

/* -----------------------------------------------------------------------------
   Aturan penuangan
   ----------------------------------------------------------------------------- */

/**
 * Memeriksa apakah menuang botol `from` ke `to` sah.
 * @returns {{ok:true, amount:number, color:string} | {ok:false, reason:string}}
 */
export function canPour(state, from, to) {
  const bottles = state.bottles;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, reason: "invalid" };
  if (from < 0 || to < 0 || from >= bottles.length || to >= bottles.length) {
    return { ok: false, reason: "invalid" };
  }
  if (from === to) return { ok: false, reason: "same-bottle" };

  const source = bottles[from];
  const target = bottles[to];
  if (source.length === 0) return { ok: false, reason: "empty-source" };
  if (freeSpace(target) === 0) return { ok: false, reason: "no-space" };

  const color = topColor(source);
  if (target.length > 0 && topColor(target) !== color) {
    return { ok: false, reason: "color-mismatch" };
  }

  const amount = Math.min(topRun(source), freeSpace(target));
  return { ok: true, amount, color };
}

/**
 * Menuang botol. Tidak mengubah state lama — hasilnya state baru.
 * @returns {{ok:false, reason:string} | {ok:true, state:object, amount:number, color:string}}
 */
export function pour(state, from, to) {
  const check = canPour(state, from, to);
  if (!check.ok) return { ok: false, reason: check.reason };

  const bottles = cloneBottles(state.bottles);
  for (let i = 0; i < check.amount; i += 1) {
    bottles[to].push(bottles[from].pop());
  }

  return {
    ok: true,
    state: { bottles, moves: (state.moves ?? 0) + 1 },
    amount: check.amount,
    color: check.color,
  };
}

/** Semua langkah yang sah dari sebuah state: [{from, to, amount, color}]. */
export function findMoves(state) {
  const moves = [];
  const total = state.bottles.length;
  for (let from = 0; from < total; from += 1) {
    for (let to = 0; to < total; to += 1) {
      const check = canPour(state, from, to);
      if (check.ok) moves.push({ from, to, amount: check.amount, color: check.color });
    }
  }
  return moves;
}

/* -----------------------------------------------------------------------------
   Kondisi selesai & kunci state
   ----------------------------------------------------------------------------- */

/** Semua botol kosong atau berisi satu warna penuh. */
export function isWon(state) {
  return state.bottles.every(isBottleDone);
}

/** Berapa botol yang sudah selesai (dipakai UI untuk progres). */
export function countDone(state) {
  return state.bottles.filter(isBottleDone).length;
}

/**
 * Kunci state yang tidak bergantung urutan botol.
 * Dipakai solver untuk mengenali state yang sama walau botolnya ditukar posisi.
 */
export function stateKey(state) {
  return state.bottles
    .map((bottle) => bottle.join("|"))
    .sort()
    .join("/");
}

/* -----------------------------------------------------------------------------
   Solver (BFS) — dipakai untuk "Petunjuk" dan pemeriksaan generator
   ----------------------------------------------------------------------------- */

/**
 * Mencari solusi terpendek dengan BFS.
 *
 * @param {object} state
 * @param {{maxStates?:number, timeLimitMs?:number}} [options]
 * @returns {{solved:boolean, moves:Array<{from:number,to:number}>, visited:number, exhausted:boolean}}
 *   `exhausted:false` berarti pencarian berhenti karena batas (bukan karena buntu).
 */
export function solve(state, options = {}) {
  const maxStates = options.maxStates ?? 120000;
  const timeLimitMs = options.timeLimitMs ?? 1500;
  const startedAt = Date.now();

  if (isWon(state)) return { solved: true, moves: [], visited: 0, exhausted: true };

  // nodes menyimpan state + induknya supaya jalur solusi bisa dilacak.
  const nodes = [{ bottles: cloneBottles(state.bottles), parent: -1, move: null }];
  const indexByKey = new Map([[stateKey(state), 0]]);

  let head = 0;
  while (head < nodes.length) {
    if (nodes.length > maxStates) {
      return { solved: false, moves: [], visited: nodes.length, exhausted: false };
    }
    if ((head & 511) === 0 && Date.now() - startedAt > timeLimitMs) {
      return { solved: false, moves: [], visited: nodes.length, exhausted: false };
    }

    const current = { bottles: nodes[head].bottles, moves: 0 };
    const moves = findMoves(current);

    for (const move of moves) {
      const result = pour(current, move.from, move.to);
      if (!result.ok) continue;

      const key = stateKey(result.state);
      if (indexByKey.has(key)) continue;

      const index = nodes.length;
      nodes.push({
        bottles: result.state.bottles,
        parent: head,
        move: { from: move.from, to: move.to },
      });
      indexByKey.set(key, index);

      if (isWon(result.state)) {
        const path = [];
        let cursor = index;
        while (cursor > 0) {
          path.push(nodes[cursor].move);
          cursor = nodes[cursor].parent;
        }
        path.reverse();
        return { solved: true, moves: path, visited: nodes.length, exhausted: true };
      }
    }

    head += 1;
  }

  // Antrean habis tanpa menemukan solusi: state ini benar-benar buntu.
  return { solved: false, moves: [], visited: nodes.length, exhausted: true };
}

/** Penilaian sederhana untuk memilih langkah saat solver kehabisan batas. */
function heuristicScore(state, move) {
  const source = state.bottles[move.from];
  const target = state.bottles[move.to];
  let score = 0;

  const targetAfter = target.length + move.amount;
  const targetBecomesDone = targetAfter === CAPACITY && target.every((c) => c === move.color);
  const sourceBecomesEmpty = source.length === move.amount;
  const sourceIsMonochrome = source.every((c) => c === source[0]);

  if (targetBecomesDone) score += 120; // langsung menuntaskan satu botol
  if (sourceBecomesEmpty) score += 30; // mengosongkan botol itu berguna
  if (target.length > 0) score += 25; // menggabung lebih baik daripada memindah ke botol kosong
  if (sourceBecomesEmpty && target.length === 0) score -= 10; // memindah tumpukan utuh ke kosong
  if (sourceIsMonochrome && target.length === 0) score -= 40; // memindah botol satu warna ke kosong
  if (freeSpace(target) > freeSpace(source)) score += 5; // cenderung mengisi botol yang lebih penuh
  score -= move.from * 0.001; // tie-break yang pasti (botol kiri lebih dulu)

  return score;
}

/**
 * Memberi satu saran langkah.
 * @returns {{from:number, to:number, exact:boolean, remaining:number|null}|null}
 *   `exact:true` berarti langkah ini bagian dari solusi terpendek (BFS).
 *   `null` berarti tidak ada langkah berguna (sudah menang atau benar-benar buntu).
 */
export function findHint(state, options = {}) {
  if (isWon(state)) return null;

  const result = solve(state, {
    maxStates: options.maxStates ?? 60000,
    timeLimitMs: options.timeLimitMs ?? 800,
  });

  if (result.solved && result.moves.length > 0) {
    return {
      from: result.moves[0].from,
      to: result.moves[0].to,
      exact: true,
      remaining: result.moves.length,
    };
  }

  if (!result.solved && result.exhausted) return null; // terbukti buntu

  // Solver kehabisan batas: pakai saran heuristik supaya pemain tetap tertolong.
  const moves = findMoves(state);
  if (!moves.length) return null;
  let best = moves[0];
  let bestScore = heuristicScore(state, best);
  for (const move of moves.slice(1)) {
    const score = heuristicScore(state, move);
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return { from: best.from, to: best.to, exact: false, remaining: null };
}

/**
 * Menerapkan urutan langkah ke sebuah state (dipakai pengujian & generator).
 * @returns {{ok:boolean, state:object, failedAt:number|null}}
 */
export function applyMoves(state, moves) {
  let current = cloneState(state);
  for (let i = 0; i < moves.length; i += 1) {
    const result = pour(current, moves[i].from, moves[i].to);
    if (!result.ok) return { ok: false, state: current, failedAt: i };
    current = result.state;
  }
  return { ok: true, state: current, failedAt: null };
}
