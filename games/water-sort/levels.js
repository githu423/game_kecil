/**
 * levels.js — data level + pembuat level acak untuk Water Sort.
 *
 * Cara kerja generator (penting supaya level SELALU bisa diselesaikan):
 *   1. Mulai dari keadaan yang sudah selesai: satu botol penuh untuk setiap warna,
 *      ditambah beberapa botol kosong.
 *   2. Kocok dengan LANGKAH TERBALIK dari penuangan yang sah (bukan menaruh warna
 *      acak ke sembarang botol). Setiap langkah terbalik dipilih supaya bisa
 *      dibalik dengan tepat, jadi membalik urutan langkah = solusi yang sah.
 *   3. Tolak hasil yang sudah dalam keadaan menang.
 *   4. Untuk level kecil, solusi diperiksa lagi memakai solver BFS di logic.js.
 */

import { CAPACITY, COLORS, cloneState, isBottleDone, isWon, pour, solve, stateKey } from "./logic.js";

/** Penanda format level. Ubah kalau aturan/level berubah besar-besaran. */
export const LEVEL_VERSION = "v1";

/**
 * Daftar level bertingkat. Semua angka sudah dipilih supaya naik sulitnya terasa.
 * colors       : jumlah warna (3–12, mengikuti panjang COLORS)
 * emptyBottles : botol kosong yang tersedia (2, kadang 3 untuk level besar)
 * scramble     : berapa banyak langkah terbalik yang dikocok
 */
export const LEVELS = Object.freeze([
  { id: 1, name: "Pemanasan", colors: 3, emptyBottles: 2, scramble: 6, keepEmpty: true, tip: "Pindahkan warna ke botol kosong dulu, lalu rapikan." },
  { id: 2, name: "Dua Tumpuk", colors: 3, emptyBottles: 2, scramble: 8, keepEmpty: true, tip: "Warna yang sama boleh digabung." },
  { id: 3, name: "Langkah Kecil", colors: 3, emptyBottles: 2, scramble: 10, keepEmpty: true, tip: "Isi penuh satu botol supaya tidak dirusak lagi." },
  { id: 4, name: "Warna Baru", colors: 4, emptyBottles: 2, scramble: 10, keepEmpty: true, tip: "Manfaatkan botol kosong sebagai tempat sementara." },
  { id: 5, name: "Empat Tumpuk", colors: 4, emptyBottles: 2, scramble: 14, tip: "Rencanakan beberapa langkah ke depan." },
  { id: 6, name: "Setengah Jalan", colors: 4, emptyBottles: 2, scramble: 18, tip: "Botol yang sudah penuh satu warna tidak perlu disentuh lagi." },
  { id: 7, name: "Lima Warna", colors: 5, emptyBottles: 2, scramble: 16, tip: "Cari warna yang paling banyak terlihat di bagian atas." },
  { id: 8, name: "Bersilang", colors: 5, emptyBottles: 2, scramble: 20, tip: "Kadang satu langkah mundur membantu dua langkah maju." },
  { id: 9, name: "Labirin Kecil", colors: 5, emptyBottles: 2, scramble: 24, tip: "Pakai tombol ↶ Batal kalau salah langkah." },
  { id: 10, name: "Enam Warna", colors: 6, emptyBottles: 2, scramble: 22, tip: "Petunjuk (💡) memakai solver, jadi selalu benar." },
  { id: 11, name: "Tumpukan Tinggi", colors: 6, emptyBottles: 2, scramble: 26, tip: "Fokus ke satu warna sampai selesai." },
  { id: 12, name: "Kacau Sedang", colors: 6, emptyBottles: 2, scramble: 30, tip: "Simpan satu botol kosong untuk memindahkan tumpukan." },
  { id: 13, name: "Tujuh Warna", colors: 7, emptyBottles: 2, scramble: 26, tip: "Cek angka langkah — makin sedikit makin bagus." },
  { id: 14, name: "Bolak-balik", colors: 7, emptyBottles: 2, scramble: 30, tip: "Jangan mengocok botol yang sudah penuh." },
  { id: 15, name: "Delapan Warna", colors: 8, emptyBottles: 2, scramble: 30, tip: "Mulai dari warna yang paling sering muncul." },
  { id: 16, name: "Pusing Ringan", colors: 8, emptyBottles: 2, scramble: 36, tip: "Kalau macet, tekan 💡 Petunjuk." },
  { id: 17, name: "Sembilan Warna", colors: 9, emptyBottles: 2, scramble: 34, tip: "+1 botol kosong hanya boleh sekali per level." },
  { id: 18, name: "Sepuluh Warna", colors: 10, emptyBottles: 2, scramble: 38, tip: "Bergerak cepat bukan berarti bergerak tepat." },
  { id: 19, name: "Sebelas Warna", colors: 11, emptyBottles: 2, scramble: 42, tip: "Sabar — level ini butuh banyak langkah." },
  { id: 20, name: "Dua Belas Warna", colors: 12, emptyBottles: 3, scramble: 46, tip: "Level terakhir: semua warna, tiga botol kosong." },
]);

export const LEVEL_COUNT = LEVELS.length;

/* -----------------------------------------------------------------------------
   Angka acak dengan seed (hasil selalu sama untuk seed yang sama)
   ----------------------------------------------------------------------------- */

/** PRNG kecil (mulberry32) — cukup untuk mengocok level. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mengubah teks seed menjadi angka (hash FNV-1a). */
export function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Seed tetap untuk satu level. */
export function levelSeed(id) {
  return `watersort-${LEVEL_VERSION}-${id}`;
}

/** Seed acak pendek untuk mode "Acak". */
export function randomSeed() {
  const number = Math.floor(Math.random() * 0xffffff);
  return number.toString(36).padStart(4, "0");
}

/* -----------------------------------------------------------------------------
   Membentuk keadaan awal & langkah terbalik
   ----------------------------------------------------------------------------- */

/**
 * Keadaan selesai: satu botol penuh per warna + botol kosong.
 * @param {number} colorCount
 * @param {number} emptyBottles
 */
export function solvedBottles(colorCount, emptyBottles) {
  const bottles = [];
  for (let i = 0; i < colorCount; i += 1) {
    const color = COLORS[i % COLORS.length].id;
    bottles.push(new Array(CAPACITY).fill(color));
  }
  for (let i = 0; i < emptyBottles; i += 1) bottles.push([]);
  return bottles;
}

/** Memilih satu item dari daftar berbobot: [[item, weight], ...] */
function pickWeighted(items, random) {
  const total = items.reduce((sum, item) => sum + item[1], 0);
  if (total <= 0) return null;
  let point = random() * total;
  for (const [item, weight] of items) {
    point -= weight;
    if (point <= 0) return item;
  }
  return items[items.length - 1][0];
}

/**
 * Mencari satu langkah terbalik yang bisa dibalik dengan tepat.
 *
 * Langkah terbalik: ambil `amount` lapis warna teratas dari botol `from` lalu
 * taruh di botol `to`. Syaratnya:
 *   - warna teratas `from` punya minimal 2 lapis, dan `amount` < jumlahnya
 *     (supaya setelah diambil, warna itu masih terlihat di puncak `from` —
 *     inilah yang membuat langkah baliknya nanti tetap sah dan tepat sama);
 *   - `to` punya ruang cukup dan bukan botol yang sama;
 *   - `to` kosong atau warna teratasnya BERBEDA. Kalau warnanya sama, tumpukan
 *     akan menyatu dan langkah baliknya bisa memindahkan lebih banyak dari yang
 *     diinginkan.
 *
 * @param {string[][]} bottles
 * @param {() => number} random
 * @param {{from:number,to:number,amount:number}|null} previous langkah terbalik sebelumnya
 * @param {{reserveEmpty?:boolean}} [options] reserveEmpty = sisakan minimal satu botol kosong
 * @returns {{from:number,to:number,amount:number,color:string}|null}
 */
export function pickReverseMove(bottles, random, previous = null, options = {}) {
  const candidates = [];
  const emptyCount = bottles.filter((bottle) => bottle.length === 0).length;

  for (let from = 0; from < bottles.length; from += 1) {
    const source = bottles[from];
    if (source.length === 0) continue;

    const color = source[source.length - 1];
    let run = 0;
    for (let i = source.length - 1; i >= 0 && source[i] === color; i -= 1) run += 1;
    if (run < 2) continue;

    for (let to = 0; to < bottles.length; to += 1) {
      if (to === from) continue;
      const target = bottles[to];
      if (target.length >= CAPACITY) continue;

      // Level pemula: jangan sampai kocokan menghabiskan botol kosong terakhir.
      if (options.reserveEmpty && target.length === 0 && emptyCount <= 1) continue;

      const topIsDifferent = target.length === 0 || target[target.length - 1] !== color;
      if (!topIsDifferent) continue;

      const maxAmount = Math.min(run - 1, CAPACITY - target.length);
      for (let amount = 1; amount <= maxAmount; amount += 1) {
        // Jangan langsung membalik langkah sebelumnya (menjadi bolak-balik tanpa guna).
        if (
          previous &&
          previous.from === to &&
          previous.to === from &&
          previous.amount === amount
        ) {
          continue;
        }

        // Botol kosong sedikit lebih disukai (membuat tumpukan baru),
        // target berwarna lain menambah "kekacauan".
        let weight = 3;
        if (target.length === 0) weight = 4;
        if (source.length - amount === 0) weight += 1; // sumber jadi kosong itu berguna
        weight += amount; // langkah besar sedikit lebih disukai supaya cepat tercampur
        candidates.push([{ from, to, amount, color }, weight]);
      }
    }
  }

  if (!candidates.length) return null;
  return pickWeighted(candidates, random);
}

/** Menerapkan langkah terbalik ke daftar botol (mengubah array di tempat). */
export function applyReverseMove(bottles, move) {
  for (let i = 0; i < move.amount; i += 1) {
    bottles[move.to].push(bottles[move.from].pop());
  }
}

/**
 * Mengubah daftar langkah terbalik menjadi solusi untuk pemain.
 *
 * Dua hal yang dibalik: URUTANNYA (langkah terakhir jadi langkah pertama) dan
 * ARAH setiap langkah (kalau tadi menuang X -> Y, solusinya menuang Y -> X).
 */
export function reverseMovesToSolution(reverseMoves) {
  return reverseMoves
    .slice()
    .reverse()
    .map((move) => ({ from: move.to, to: move.from }));
}

/* -----------------------------------------------------------------------------
   Generator level
   ----------------------------------------------------------------------------- */

/**
 * Membuat satu puzzle Water Sort yang dijamin bisa diselesaikan.
 *
 * @param {{colors:number, emptyBottles:number, scramble:number, seed:string,
 *          attempts?:number, verify?:boolean}} options
 * @returns {{state:object, solution:Array<{from:number,to:number}>, seed:string,
 *            scramble:number, attemptsUsed:number, verified:boolean}}
 */
export function generatePuzzle(options) {
  const colors = Math.max(1, Math.min(options.colors ?? 4, COLORS.length));
  const emptyBottles = Math.max(1, options.emptyBottles ?? 2);
  const scramble = Math.max(1, options.scramble ?? 10);
  const attempts = options.attempts ?? 8;
  const verify = options.verify ?? colors <= 6;
  const reserveEmpty = Boolean(options.keepEmpty);

  // Kalau pengocokan berhenti terlalu cepat, levelnya jadi terlalu mudah.
  // Jadi kita coba beberapa seed dan simpan hasil terbaik yang masih memenuhi syarat.
  const minimumScramble = Math.max(1, Math.ceil(scramble * 0.8));
  let best = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const seed = `${options.seed}#${attempt}`;
    const random = mulberry32(hashSeed(seed));
    const bottles = solvedBottles(colors, emptyBottles);
    const reverseMoves = [];
    let previous = null;

    let guard = 0;
    const guardLimit = scramble * 12 + 40;
    while (reverseMoves.length < scramble && guard < guardLimit) {
      guard += 1;
      const move = pickReverseMove(bottles, random, previous, { reserveEmpty });
      if (!move) break;
      applyReverseMove(bottles, move);
      reverseMoves.push(move);
      previous = move;
    }

    const state = { bottles, moves: 0 };

    // Syarat wajib: tidak menang sejak awal, cukup teracak, cukup banyak botol
    // yang belum selesai, dan (untuk level kecil) lolos pemeriksaan solver.
    if (reverseMoves.length === 0) continue;
    if (isWon(state)) continue;
    if (reserveEmpty && !bottles.some((bottle) => bottle.length === 0)) continue;
    const unfinished = bottles.filter((bottle) => !isBottleDone(bottle)).length;
    if (unfinished < 3) continue;

    let verified = false;
    if (verify) {
      const check = solve(cloneState(state), { maxStates: 30000, timeLimitMs: 600 });
      if (check.exhausted && !check.solved) continue; // mustahil terjadi, tapi aman
      verified = check.solved;
    }

    const candidate = {
      state,
      solution: reverseMovesToSolution(reverseMoves),
      seed,
      scramble: reverseMoves.length,
      attemptsUsed: attempt + 1,
      verified,
    };

    if (reverseMoves.length >= minimumScramble) return candidate;
    if (!best || reverseMoves.length > best.scramble) best = candidate;
  }

  if (best) return best;

  // Cadangan terakhir: pakai aturan pengocokan yang sama tanpa pemeriksaan solver.
  const bottles = solvedBottles(colors, emptyBottles);
  const random = mulberry32(hashSeed(`${options.seed}#fallback`));
  const reverseMoves = [];
  let previous = null;
  while (reverseMoves.length < scramble) {
    const move = pickReverseMove(bottles, random, previous);
    if (!move) break;
    applyReverseMove(bottles, move);
    reverseMoves.push(move);
    previous = move;
  }
  return {
    state: { bottles, moves: 0 },
    solution: reverseMovesToSolution(reverseMoves),
    seed: `${options.seed}#fallback`,
    scramble: reverseMoves.length,
    attemptsUsed: attempts,
    verified: false,
  };
}

/* -----------------------------------------------------------------------------
   API yang dipakai UI
   ----------------------------------------------------------------------------- */

const stateCache = new Map();

/** Konfigurasi level (aman untuk id di luar jangkauan). */
export function getLevelConfig(id) {
  if (id >= 1 && id <= LEVEL_COUNT) return LEVELS[id - 1];
  return LEVELS[0];
}

/**
 * State untuk sebuah level (dibuat sekali, lalu disimpan di cache).
 * @returns {{state:object, solution:Array<{from:number,to:number}>, config:object}}
 */
export function createLevelState(id) {
  const config = getLevelConfig(id);
  if (stateCache.has(config.id)) return stateCache.get(config.id);

  const generated = generatePuzzle({
    colors: config.colors,
    emptyBottles: config.emptyBottles,
    scramble: config.scramble,
    keepEmpty: config.keepEmpty,
    seed: levelSeed(config.id),
  });

  const entry = {
    config,
    state: generated.state,
    solution: generated.solution,
    seed: generated.seed,
    verified: generated.verified,
  };
  stateCache.set(config.id, entry);
  return entry;
}

/** Level acak untuk mode "Acak". */
export function createRandomLevel(options = {}) {
  const seed = options.seed ?? randomSeed();
  const colors = options.colors ?? 6;
  const emptyBottles = options.emptyBottles ?? 2;
  const scramble = options.scramble ?? 24;

  const generated = generatePuzzle({
    colors,
    emptyBottles,
    scramble,
    seed: `acak-${seed}`,
    verify: false, // level acak besar: solusi sudah dijamin oleh cara mengocok
    keepEmpty: options.keepEmpty ?? false,
  });

  return {
    config: {
      id: 0,
      name: `Acak (${seed})`,
      colors,
      emptyBottles,
      scramble,
      tip: "Level acak: kocokannya dibuat dari langkah terbalik, jadi pasti bisa diselesaikan.",
    },
    state: generated.state,
    solution: generated.solution,
    seed: generated.seed,
    verified: generated.verified,
  };
}

/**
 * Menambah satu botol kosong (fitur "+1 botol kosong", sekali per level).
 * @returns {object} state baru dengan satu botol kosong tambahan
 */
export function addEmptyBottle(state) {
  const next = cloneState(state);
  next.bottles.push([]);
  return next;
}

/**
 * Menyelesaikan level memakai solusi referensi (dipakai pengujian).
 * @returns {{ok:boolean, state:object, failedAt:number|null}}
 */
export function applyLevelSolution(entry) {
  let current = cloneState(entry.state);
  for (let i = 0; i < entry.solution.length; i += 1) {
    const result = pour(current, entry.solution[i].from, entry.solution[i].to);
    if (!result.ok) return { ok: false, state: current, failedAt: i };
    current = result.state;
  }
  return { ok: true, state: current, failedAt: null };
}

/** Ringkasan singkat level (dipakai daftar level di UI). */
export function listLevels() {
  return LEVELS.map((level) => ({
    id: level.id,
    name: level.name,
    colors: level.colors,
    emptyBottles: level.emptyBottles,
    tip: level.tip,
  }));
}

/** State awal untuk pengujian tanpa cache. */
export function generateLevelState(id) {
  const config = getLevelConfig(id);
  return generatePuzzle({
    colors: config.colors,
    emptyBottles: config.emptyBottles,
    scramble: config.scramble,
    keepEmpty: config.keepEmpty,
    seed: levelSeed(config.id),
  });
}

export { CAPACITY, isWon, stateKey };
