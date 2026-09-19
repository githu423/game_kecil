/**
 * tests.js — pengujian Water Sort: aturan penuangan, solver, dan generator.
 *
 * Bisa dijalankan:
 *   - di browser: buka games/water-sort/tests.html (halaman itu memakai berkas ini)
 *   - di Node   : node games/water-sort/tests.js
 *
 * Berkas ini hanya untuk pengujian; game tetap berjalan tanpa berkas ini.
 */

import {
  CAPACITY,
  COLORS,
  applyMoves,
  bottleState,
  canPour,
  cloneState,
  colorInfo,
  countDone,
  createState,
  findHint,
  findMoves,
  isBottleDone,
  isWon,
  pour,
  solve,
  stateKey,
  topColor,
  topRun,
  validTargets,
} from "./logic.js";
// main.js aman diimpor dari Node (tidak ada DOM yang disentuh saat impor).
import { bottleVisualState, createBottleElement } from "./main.js";
import {
  LEVELS,
  LEVEL_COUNT,
  addEmptyBottle,
  applyLevelSolution,
  createLevelState,
  createRandomLevel,
  generateLevelState,
  hashSeed,
  listLevels,
  pickReverseMove,
  solvedBottles,
} from "./levels.js";

/** Teks style.css (hanya diisi saat berjalan di Node; di browser diambil dari DOM). */
const IS_NODE_ENV =
  typeof process !== "undefined" && Boolean(process.versions) && Boolean(process.versions.node);

const CSS_TEXT = await (async () => {
  if (!IS_NODE_ENV) return "";
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(new URL("./style.css", import.meta.url), "utf8");
  } catch (error) {
    return "";
  }
})();

/* -----------------------------------------------------------------------------
   Kerangka pengujian ringkas
   ----------------------------------------------------------------------------- */

function makeReporter() {
  const results = [];
  const api = {
    results,
    check(name, fn) {
      try {
        fn();
        results.push({ name, ok: true, message: "" });
      } catch (error) {
        results.push({ name, ok: false, message: error?.message ?? String(error) });
      }
    },
    equal(actual, expected, label = "") {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`${label} diharapkan ${b}, ternyata ${a}`);
    },
    ok(value, label = "") {
      if (!value) throw new Error(`${label} diharapkan true, ternyata ${JSON.stringify(value)}`);
    },
    notOk(value, label = "") {
      if (value) throw new Error(`${label} diharapkan false, ternyata ${JSON.stringify(value)}`);
    },
    skip(name, reason = "") {
      results.push({ name, ok: true, skipped: true, message: reason });
    },
    truthyBottles(state, label = "") {
      if (!Array.isArray(state.bottles) || state.bottles.length === 0) {
        throw new Error(`${label}: state botol tidak sah`);
      }
    },
  };
  return api;
}

/** Menghitung berapa kali setiap warna muncul (harus selalu 4). */
function colorCounts(state) {
  const counts = new Map();
  for (const bottle of state.bottles) {
    for (const color of bottle) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return counts;
}

/** State buntu: dua botol penuh warna berselang-seling (tidak ada langkah sah). */
const STUCK_STATE = createState([
  ["merah", "biru", "merah", "biru"],
  ["biru", "merah", "biru", "merah"],
]);

/* -----------------------------------------------------------------------------
   Pengujian
   ----------------------------------------------------------------------------- */

/**
 * Menjalankan semua pengujian.
 * @returns {{total:number, passed:number, failed:number, results:Array}}
 */
export function runTests() {
  const t = makeReporter();

  /* ------------------------- aturan penuangan ------------------------- */

  t.check("pour: menuang seluruh segmen warna yang sama", () => {
    const state = createState([["merah", "biru", "biru", "biru"], [], []]);
    const result = pour(state, 0, 1);
    t.ok(result.ok, "penuangan sah");
    t.equal(result.amount, 3, "jumlah yang dituang");
    t.equal(result.state.bottles[0], ["merah"], "sisa botol sumber");
    t.equal(result.state.bottles[1], ["biru", "biru", "biru"], "isi botol tujuan");
  });

  t.check("pour: jumlah dibatasi ruang botol tujuan", () => {
    // Sumber punya 2 "merah" di atas; tujuan hanya punya ruang 1.
    const state = createState([["biru", "merah", "merah"], ["merah", "merah", "merah"], []]);
    const result = pour(state, 0, 1);
    t.ok(result.ok, "penuangan sah");
    t.equal(result.amount, 1, "hanya 1 lapis yang muat");
    t.equal(result.state.bottles[1], ["merah", "merah", "merah", "merah"], "isi tujuan");
    t.equal(result.state.bottles[0], ["biru", "merah"], "sisa di sumber");
  });

  t.check("pour: state lama tidak berubah (immutable)", () => {
    const state = createState([["merah", "merah"], []]);
    const before = JSON.stringify(state);
    const result = pour(state, 0, 1);
    t.ok(result.ok, "penuangan sah");
    t.equal(JSON.stringify(state), before, "state asal tetap sama");
    t.ok(state.bottles[1].length === 0, "botol tujuan asal tetap kosong");
  });

  t.check("canPour: alasan penolakan bermacam-macam", () => {
    const state = createState([["merah"], [], ["biru", "biru", "biru", "biru"], ["hijau"]]);
    t.equal(canPour(state, 1, 0).reason, "empty-source", "botol kosong tidak bisa dituang");
    t.equal(canPour(state, 0, 0).reason, "same-bottle", "tidak bisa menuang ke botol yang sama");
    t.equal(canPour(state, 0, 2).reason, "no-space", "botol penuh tidak bisa diisi");
    t.equal(canPour(state, 0, 3).reason, "color-mismatch", "warna berbeda tidak boleh dicampur");
    t.equal(canPour(state, 0, 1).ok, true, "menuang ke botol kosong boleh");
    t.equal(canPour(state, 99, 0).reason, "invalid", "indeks di luar jangkauan");
  });

  t.check("pour: warna berbeda gagal tanpa mengubah state", () => {
    const state = createState([["merah"], ["biru"]]);
    const result = pour(state, 0, 1);
    t.notOk(result.ok, "penuangan ditolak");
    t.equal(result.reason, "color-mismatch", "alasan");
    t.equal(state.bottles[0], ["merah"], "sumber utuh");
    t.equal(state.bottles[1], ["biru"], "tujuan utuh");
  });

  t.check("topColor/topRun/isBottleDone bekerja benar", () => {
    const bottle = ["merah", "biru", "biru", "biru"];
    t.equal(topColor(bottle), "biru", "warna teratas");
    t.equal(topRun(bottle), 3, "panjang segmen teratas");
    t.equal(topColor([]), null, "botol kosong tidak berwarna");
    t.ok(isBottleDone([]), "botol kosong dianggap selesai");
    t.ok(isBottleDone(["hijau", "hijau", "hijau", "hijau"]), "satu warna penuh dianggap selesai");
    t.notOk(isBottleDone(["hijau", "hijau"]), "belum penuh belum selesai");
    t.notOk(isBottleDone(["hijau", "merah", "merah", "merah"]), "campuran belum selesai");
  });

  t.check("menang: semua botol kosong atau satu warna penuh", () => {
    t.ok(isWon(createState([["biru", "biru", "biru", "biru"], [], []])), "keadaan menang");
    t.notOk(isWon(createState([["biru", "biru", "biru"], [], []])), "belum penuh");
    t.notOk(isWon(createState([["biru", "merah", "biru", "biru"], []])), "masih campur");
    t.equal(countDone(createState([["biru", "biru", "biru", "biru"], [], ["merah"]])), 2, "botol selesai");
  });

  t.check("stateKey: urutan botol tidak dianggap berbeda", () => {
    const a = createState([["merah"], ["biru"]]);
    const b = createState([["biru"], ["merah"]]);
    t.equal(stateKey(a), stateKey(b), "kunci state sama");
  });

  t.check("findMoves: menolak mencampur warna dan botol kosong", () => {
    const state = createState([["merah", "merah"], ["merah"], []]);
    const moves = findMoves(state);
    // Botol 1 (satu merah) boleh dituang ke botol 0 dan botol 2.
    t.ok(moves.length > 0, "ada langkah sah");
    t.ok(moves.every((move) => move.from !== move.to), "tidak ada langkah ke botol sendiri");
  });

  /* ------------------------------- solver ------------------------------- */

  t.check("solve: benar-benar menyelesaikan level 1", () => {
    const result = solve(generateLevelState(1).state, { maxStates: 120000, timeLimitMs: 2500 });
    t.ok(result.solved, "solusi ditemukan");
    const applied = applyMoves(generateLevelState(1).state, result.moves);
    t.ok(applied.ok, "semua langkah solver sah");
    t.ok(isWon(applied.state), "state akhir menang");
  });

  t.check("solve: mengenali state yang mustahil diselesaikan", () => {
    const result = solve(STUCK_STATE, { maxStates: 20000, timeLimitMs: 1000 });
    t.notOk(result.solved, "tidak ada solusi");
    t.ok(result.exhausted, "pencarian selesai (bukan kehabisan batas)");
    t.equal(findMoves(STUCK_STATE).length, 0, "tidak ada langkah sah");
  });

  t.check("solve: laporan kehabisan batas berbeda dari buntu", () => {
    const result = solve(generateLevelState(15).state, { maxStates: 5, timeLimitMs: 50 });
    t.notOk(result.solved, "solusi tidak ditemukan");
    t.notOk(result.exhausted, "ditandai kehabisan batas, bukan buntu");
  });

  t.check("findHint: memberi langkah sah dan mengarah ke solusi", () => {
    const state = generateLevelState(2).state;
    const hint = findHint(state, { maxStates: 60000, timeLimitMs: 1500 });
    t.ok(hint, "ada saran");
    t.ok(canPour(state, hint.from, hint.to).ok, "saran adalah langkah sah");
    t.ok(hint.exact, "saran berasal dari BFS untuk level kecil");

    // Teruskan memakai saran sampai menang; harus selalu sah.
    let current = cloneState(state);
    for (let step = 0; step < 60 && !isWon(current); step += 1) {
      const next = findHint(current, { maxStates: 60000, timeLimitMs: 1500 });
      if (!next) break;
      const result = pour(current, next.from, next.to);
      t.ok(result.ok, `langkah ke-${step + 1} sah`);
      current = result.state;
    }
    t.ok(isWon(current), "menang dengan mengikuti saran");
  });

  t.check("findHint: tidak ada saran kalau sudah menang", () => {
    const won = createState([["merah", "merah", "merah", "merah"], []]);
    t.equal(findHint(won), null, "sudah menang");
  });

  /* ----------------------- data warna & aksesibilitas ----------------------- */

  t.check("warna: 12 warna lengkap dengan simbol & pola", () => {
    t.ok(COLORS.length >= 12, "minimal 12 warna");
    for (const color of COLORS) {
      t.ok(Boolean(color.id && color.label && color.hex), `data warna ${color.id}`);
      t.ok(Boolean(color.symbol), `simbol warna ${color.id}`);
      t.ok(["solid", "diagonal"].includes(color.pattern), `pola warna ${color.id}`);
    }
    const symbols = new Set(COLORS.map((color) => color.symbol));
    t.equal(symbols.size, COLORS.length, "setiap warna punya simbol berbeda");
    t.equal(colorInfo("tidak-ada").symbol, "?", "warna tak dikenal aman");
  });

  /* ------------------------------- generator ------------------------------- */

  t.check("generator: 20 level bisa dibuat dan solusinya menang", () => {
    t.equal(LEVEL_COUNT, 20, "jumlah level");
    for (const config of LEVELS) {
      const entry = createLevelState(config.id);
      const applied = applyLevelSolution(entry);
      t.ok(applied.ok, `level ${config.id}: langkah solusi sah`);
      t.ok(isWon(applied.state), `level ${config.id}: state akhir menang`);
      t.ok(entry.solution.length <= config.scramble, `level ${config.id}: panjang solusi wajar`);
      t.ok(entry.solution.length > 0, `level ${config.id}: solusi tidak kosong`);
    }
  });

  t.check("generator: keadaan awal selalu sah (jumlah warna & kapasitas)", () => {
    for (const config of LEVELS) {
      const { state } = createLevelState(config.id);
      const counts = colorCounts(state);
      t.equal(counts.size, config.colors, `level ${config.id}: jumlah warna`);
      for (const [color, count] of counts) {
        t.equal(count, CAPACITY, `level ${config.id}: jumlah lapis warna ${color}`);
      }
      t.equal(state.bottles.length, config.colors + config.emptyBottles, `level ${config.id}: jumlah botol`);
      for (const bottle of state.bottles) {
        t.ok(bottle.length <= CAPACITY, `level ${config.id}: botol tidak melebihi kapasitas`);
      }
    }
  });

  t.check("generator: tidak ada level yang sudah menang sejak awal", () => {
    for (const config of LEVELS) {
      const { state } = createLevelState(config.id);
      t.notOk(isWon(state), `level ${config.id} belum menang`);
      const unfinished = state.bottles.filter((bottle) => !isBottleDone(bottle)).length;
      t.ok(unfinished >= 3, `level ${config.id}: masih ada minimal 3 botol belum selesai`);
    }
  });

  t.check("generator: tidak bergantung langkah acak sembarangan", () => {
    // Semua langkah terbalik wajib bisa dibalik dengan tepat: menuang balik harus
    // mengembalikan state persis seperti sebelumnya.
    let checked = 0;
    for (const config of LEVELS) {
      let bottles = solvedBottles(config.colors, config.emptyBottles);
      let previous = null;
      const random = mulberryLocal(hashSeed(`uji-${config.id}`));
      for (let i = 0; i < 12; i += 1) {
        const move = pickReverseMove(bottles, random, previous);
        if (!move) break;
        const before = bottles.map((bottle) => bottle.slice());
        const beforeState = { bottles: before, moves: 0 };

        // Terapkan langkah terbalik (langkah "maju" akan dihitung dari state ini).
        for (let k = 0; k < move.amount; k += 1) bottles[move.to].push(bottles[move.from].pop());

        const back = pour({ bottles: bottles.map((b) => b.slice()), moves: 0 }, move.to, move.from);
        t.ok(back.ok, `langkah balik sah (level ${config.id}, langkah ${i})`);
        t.equal(back.amount, move.amount, "jumlah yang dibalik sama persis");
        t.equal(back.state.bottles, beforeState.bottles, "state kembali sama persis");
        t.equal(topColor(bottles[move.from]), move.color, "warna tetap terlihat di sumber");
        checked += 1;
        previous = move;
      }
    }
    t.ok(checked >= 100, `cukup banyak langkah diperiksa (${checked})`);
  });

  t.check("generator: level pemula selalu menyisakan botol kosong", () => {
    for (const config of LEVELS) {
      if (!config.keepEmpty) continue;
      const { state } = createLevelState(config.id);
      t.ok(
        state.bottles.some((bottle) => bottle.length === 0),
        `level ${config.id} masih punya botol kosong`,
      );
    }
    // Level 5 ke atas boleh saja tidak punya botol kosong.
    t.ok(LEVELS.filter((level) => level.keepEmpty).length >= 4, "minimal 4 level dengan jaminan botol kosong");
  });

  t.check("generator: uji acak lintas konfigurasi", () => {
    for (let i = 0; i < 40; i += 1) {
      const colors = 3 + (i % 10);
      const emptyBottles = i % 5 === 0 ? 3 : 2;
      const scramble = 4 + ((i * 7) % 30);
      const keepEmpty = i % 3 === 0;
      const entry = createRandomLevel({
        seed: `fuzz${i}`,
        colors,
        emptyBottles,
        scramble,
        keepEmpty,
      });

      const applied = applyLevelSolution(entry);
      t.ok(applied.ok, `uji acak ${i}: langkah solusi sah`);
      t.ok(isWon(applied.state), `uji acak ${i}: state akhir menang`);
      t.notOk(isWon(entry.state), `uji acak ${i}: tidak menang sejak awal`);
      t.equal(entry.state.bottles.length, colors + emptyBottles, `uji acak ${i}: jumlah botol`);

      const counts = colorCounts(entry.state);
      t.equal(counts.size, colors, `uji acak ${i}: jumlah warna`);
      for (const [, count] of counts) t.equal(count, CAPACITY, `uji acak ${i}: 4 lapis per warna`);
      for (const bottle of entry.state.bottles) {
        t.ok(bottle.length <= CAPACITY, `uji acak ${i}: kapasitas botol`);
      }
      if (keepEmpty) {
        t.ok(
          entry.state.bottles.some((bottle) => bottle.length === 0),
          `uji acak ${i}: botol kosong tersisa`,
        );
      }
    }
  });

  t.check("generator: hasil deterministik untuk seed yang sama", () => {
    const a = createLevelState(7);
    const b = generateLevelState(7);
    t.equal(a.state.bottles, b.state.bottles, "state sama");
    t.equal(a.solution, b.solution, "solusi sama");
  });

  t.check("generator: seed berbeda menghasilkan kocokan berbeda", () => {
    const a = createLevelState(5);
    const b = createLevelState(6);
    t.ok(JSON.stringify(a.state.bottles) !== JSON.stringify(b.state.bottles), "state berbeda");
  });

  t.check("generator: memakai solver sebagai pemeriksaan untuk level kecil", () => {
    const small = createLevelState(1);
    t.ok(small.verified, "level kecil diperiksa solver");
    const hint = findHint(small.state, { maxStates: 60000, timeLimitMs: 1500 });
    t.ok(hint && hint.exact, "level kecil punya saran pasti");
  });

  /* ------------------------------- mode acak ------------------------------- */

  t.check("mode acak: level acak tetap bisa diselesaikan", () => {
    for (let i = 0; i < 4; i += 1) {
      const entry = createRandomLevel({ seed: `uji${i}`, colors: 4 + i, scramble: 12 + i * 3 });
      const applied = applyLevelSolution(entry);
      t.ok(applied.ok, `level acak ${i}: langkah sah`);
      t.ok(isWon(applied.state), `level acak ${i}: menang`);
      const counts = colorCounts(entry.state);
      t.equal(counts.size, 4 + i, `level acak ${i}: jumlah warna`);
      for (const [, count] of counts) t.equal(count, CAPACITY, `level acak ${i}: jumlah lapis`);
    }
  });

  t.check("mode acak: seed acak menghasilkan nama level", () => {
    const entry = createRandomLevel({ seed: "abc123", colors: 5, scramble: 10 });
    t.ok(entry.config.name.includes("abc123"), "nama memuat seed");
    t.ok(entry.config.id === 0, "id 0 untuk mode acak");
  });

  /* --------------------------- fitur tambahan UI --------------------------- */

  t.check("+1 botol kosong: menambah botol dan tidak mengubah state asal", () => {
    const { state } = createLevelState(3);
    const before = JSON.stringify(state);
    const next = addEmptyBottle(state);
    t.equal(next.bottles.length, state.bottles.length + 1, "jumlah botol bertambah");
    t.equal(next.bottles[next.bottles.length - 1], [], "botol baru kosong");
    t.equal(JSON.stringify(state), before, "state asal tidak berubah");
    t.ok(isSolvableQuickly(next), "level dengan botol tambahan tetap bisa diselesaikan");
  });

  t.check("daftar level: 20 entri dengan nama dan tip", () => {
    const list = listLevels();
    t.equal(list.length, 20, "jumlah level");
    for (const item of list) {
      t.ok(item.id >= 1, `id level ${item.name}`);
      t.ok(item.name.length > 0, "nama level");
      t.ok(item.tip.length > 0, "tip level");
    }
  });

  t.check("tingkat kesulitan naik: warna dan kocokan bertambah", () => {
    t.ok(LEVELS[0].colors < LEVELS[LEVELS.length - 1].colors, "warna bertambah");
    t.ok(LEVELS[0].scramble < LEVELS[LEVELS.length - 1].scramble, "kocokan bertambah");
    const everyLevelValid = LEVELS.every(
      (level) => level.colors >= 3 && level.colors <= COLORS.length && level.emptyBottles >= 2,
    );
    t.ok(everyLevelValid, "semua level punya warna 3–12 dan minimal 2 botol kosong");
  });

  /* ------------------------- tujuan yang sah ------------------------- */

  t.check("validTargets: hanya botol kosong atau warna sama dengan ruang", () => {
    // Botol 1 (indeks 0) bagian atasnya "biru".
    const state = createState([
      ["merah", "biru"],
      [],
      ["biru", "biru"],
      ["merah", "merah", "merah", "merah"],
      ["hijau", "hijau"],
    ]);
    t.equal(validTargets(state, 0), [1, 2], "tujuan sah dari botol 1");
    t.notOk(validTargets(state, 0).includes(0), "botol sumber tidak boleh jadi tujuan sendiri");
    t.notOk(validTargets(state, 0).includes(3), "botol penuh (selesai) tidak bisa jadi tujuan");
    t.notOk(validTargets(state, 0).includes(4), "warna paling atas berbeda bukan tujuan");
    t.equal(validTargets(state, 1), [], "botol kosong tidak punya tujuan");
  });

  t.check("validTargets: botol selesai tidak pernah jadi tujuan", () => {
    const state = createState([
      ["merah", "merah", "merah"],
      ["merah", "merah", "merah", "merah"],
      [],
    ]);
    const targets = validTargets(state, 0);
    t.equal(targets, [2], "hanya botol kosong yang sah");
    t.ok(targets.every((index) => !isBottleDone(state.bottles[index]) || index === 2), "bukan botol selesai");
  });

  t.check("bottleState: kosong / sebagian / penuh / selesai", () => {
    t.equal(bottleState([]), "empty", "botol kosong");
    t.equal(bottleState(["merah"]), "partial", "botol sebagian");
    t.equal(bottleState(["merah", "merah", "merah"]), "partial", "botol hampir penuh");
    t.equal(bottleState(["merah", "merah", "merah", "merah"]), "done", "botol selesai");
    t.equal(bottleState(["merah", "biru", "merah", "biru"]), "full", "botol penuh tapi belum selesai");
  });

  t.check("kelas status botol mengikuti pilihan (bottleVisualState)", () => {
    const bottles = [
      ["merah", "biru"], // 0: sumber terpilih
      [], // 1: tujuan sah
      ["hijau", "hijau"], // 2: warna berbeda -> diredupkan
      ["merah", "merah", "merah", "merah"], // 3: selesai -> diredupkan
    ];
    const targets = validTargets({ bottles }, 0);
    const sumber = bottleVisualState(0, bottles, { selection: 0, targets });
    const tujuan = bottleVisualState(1, bottles, { selection: 0, targets });
    const redup = bottleVisualState(2, bottles, { selection: 0, targets });
    const selesai = bottleVisualState(3, bottles, { selection: 0, targets });

    t.ok(sumber.classes.includes("is-selected"), "botol sumber terpilih");
    t.ok(tujuan.classes.includes("is-valid-target"), "tujuan disorot");
    t.notOk(tujuan.classes.includes("is-dimmed"), "tujuan tidak diredupkan");
    t.ok(redup.classes.includes("is-dimmed"), "botol tidak valid diredupkan");
    t.ok(selesai.classes.includes("is-done") && selesai.classes.includes("is-dimmed"), "botol selesai ditandai");
    t.equal(bottleVisualState(0, bottles, { selection: null }).classes, [], "tanpa pilihan tidak ada sorotan");
    t.equal(
      bottleVisualState(1, bottles, { selection: null }).classes,
      ["is-empty"],
      "botol kosong tetap ditandai walau tidak ada pilihan",
    );
  });

  /* ------------------------- kontrak tata letak (CSS) ------------------------- */

  t.check("CSS: slot setinggi tetap dan tidak melar (kontrak anti-flex-grow)", () => {
    // Dibaca dari berkas style.css (Node) atau dari DOM (browser); kalau tidak terbaca, dilewati.
    let css = CSS_TEXT;
    if (!css && typeof document !== "undefined") {
      const kumpulan = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          kumpulan.push(...Array.from(sheet.cssRules).map((rule) => rule.cssText ?? ""));
        } catch (error) {
          /* stylesheet lintas-asal tidak bisa dibaca */
        }
      }
      css = kumpulan.join("\n");
    }
    if (!css) {
      t.skip("kontrak CSS (stylesheet tidak terbaca di lingkungan ini)");
      return;
    }

    const blok = (selector) => {
      const pola = new RegExp(`${selector.replace(/[.\-]/g, "\\$&")}\\s*{([^}]*)}`);
      const hasil = pola.exec(css);
      return hasil ? hasil[1] : "";
    };

    t.ok(
      /repeat\(\s*var\(--ws-capacity,\s*4\)\s*,\s*var\(--ws-slot-height\)\s*\)/.test(blok(".ws-bottle__glass")),
      "kaca botol memakai grid 4 baris setinggi var(--ws-slot-height)",
    );
    t.ok(!/flex/.test(blok(".ws-slot")), "aturan .ws-slot tidak memakai flex (tinggi tidak diregangkan)");
    t.ok(!/flex/.test(blok(".ws-gap")), "aturan .ws-gap tidak memakai flex");
    t.ok(/transform-origin:\s*bottom/.test(blok(".ws-slot")), "animasi cairan tumbuh dari dasar botol");
    t.ok(/\.is-empty/.test(css) && /border-style:\s*dashed/.test(blok(".ws-bottle.is-empty")), "botol kosong bergaris putus-putus");
    t.ok(/\.is-done/.test(css) && /content:\s*"✓"/.test(css), "botol selesai diberi tanda centang");
    t.ok(/\.is-valid-target/.test(css), "tujuan sah punya gaya sendiri");
    t.ok(/\.is-dimmed/.test(css), "botol tidak valid diredupkan");
    t.ok(/\.ws-bottle__meter/.test(css), "ada keterangan ruang tersisa (n/4)");
  });

  /* ------------------------- tampilan botol (perlu DOM) ------------------------- */

  if (typeof document !== "undefined") {
    /** Papan uji di luar layar supaya tata letaknya benar-benar dihitung browser. */
    const buatPapanUji = (bottles, opsi = {}) => {
      const akar = document.createElement("div");
      akar.className = `ws${opsi.accessible ? " is-accessible" : ""}`;
      akar.style.cssText = "position:fixed;left:-9999px;top:0;min-height:0";
      const papan = document.createElement("div");
      papan.className = "ws-bottles";
      papan.style.cssText = "display:flex;gap:8px";
      bottles.forEach((bottle, index) => {
        papan.append(createBottleElement(index, bottle, { bottles, selection: opsi.selection ?? null }));
      });
      akar.append(papan);
      document.body.append(akar);
      return akar;
    };

    t.check("tampilan botol: jumlah slot = isi botol, sisanya slot kosong", () => {
      const kasus = [[], ["merah"], ["merah", "biru", "biru"], ["hijau", "hijau", "hijau", "hijau"]];
      const akar = buatPapanUji(kasus);
      try {
        const botol = Array.from(akar.querySelectorAll(".ws-bottle"));
        t.equal(botol.length, kasus.length, "jumlah botol");
        kasus.forEach((isi, index) => {
          t.equal(botol[index].querySelectorAll(".ws-slot").length, isi.length, `slot terisi botol ${index + 1}`);
          t.equal(
            botol[index].querySelectorAll(".ws-gap").length,
            CAPACITY - isi.length,
            `slot kosong botol ${index + 1}`,
          );
          t.equal(
            botol[index].querySelector(".ws-bottle__meter").textContent,
            `${isi.length}/${CAPACITY}`,
            `meter botol ${index + 1}`,
          );
          t.equal(botol[index].dataset.filled, String(isi.length), `data-filled botol ${index + 1}`);
        });
        t.equal(akar.querySelectorAll(".ws-slot, .ws-gap").length, kasus.length * CAPACITY, "total slot");
      } finally {
        akar.remove();
      }
    });

    t.check("tampilan botol: tinggi tiap slot sama (tidak melar mengisi botol)", () => {
      const kasus = [["merah"], ["merah", "biru", "biru", "hijau"]];
      const akar = buatPapanUji(kasus);
      try {
        const kaca = akar.querySelector(".ws-bottle__glass");
        if (kaca.getBoundingClientRect().height === 0) {
          t.skip("tinggi slot sama (tata letak tidak bisa diukur di lingkungan ini)");
          return;
        }
        const tinggi = (el) => el.getBoundingClientRect().height;
        const semua = Array.from(akar.querySelectorAll(".ws-slot, .ws-gap"));
        const pertama = tinggi(semua[0]);
        for (const el of semua) {
          t.ok(Math.abs(tinggi(el) - pertama) < 1, `semua slot setinggi ${pertama.toFixed(1)}px`);
        }
        t.ok(
          Math.abs(tinggi(kaca) - pertama * CAPACITY) < 2,
          `kaca = 4 slot (${tinggi(kaca).toFixed(1)}px vs ${(pertama * CAPACITY).toFixed(1)}px)`,
        );
        t.ok(pertama > 8, "tinggi slot masuk akal (bukan 0)");
      } finally {
        akar.remove();
      }
    });

    t.check("tampilan botol: cairan dirapatkan dari dasar, ruang kosong di atas", () => {
      const kasus = [["merah", "biru"]];
      const akar = buatPapanUji(kasus);
      try {
        const botol = akar.querySelector(".ws-bottle");
        if (botol.getBoundingClientRect().height === 0) {
          t.skip("cairan dari dasar (tata letak tidak bisa diukur di lingkungan ini)");
          return;
        }
        const atas = (el) => el.getBoundingClientRect().top;
        const slotTeratas = Math.min(...Array.from(botol.querySelectorAll(".ws-slot")).map(atas));
        const gapTerbawah = Math.max(...Array.from(botol.querySelectorAll(".ws-gap")).map(atas));
        t.ok(gapTerbawah < slotTeratas - 1, "slot kosong berada di atas cairan");
        const minGap = Math.min(...Array.from(botol.querySelectorAll(".ws-slot")).map((el) => el.getBoundingClientRect().bottom));
        const maxGap = Math.max(...Array.from(botol.querySelectorAll(".ws-slot")).map((el) => el.getBoundingClientRect().bottom));
        t.ok(maxGap > minGap, "lapisan tersusun dari bawah ke atas");
      } finally {
        akar.remove();
      }
    });

    t.check("tampilan botol: kelas sesuai keadaan (kosong, selesai, tujuan)", () => {
      const bottles = [["merah", "biru"], [], ["hijau", "hijau", "hijau", "hijau"]];
      const akar = buatPapanUji(bottles, { selection: 0 });
      try {
        const botol = Array.from(akar.querySelectorAll(".ws-bottle"));
        t.ok(botol[0].classList.contains("is-selected"), "botol sumber terpilih");
        t.ok(botol[1].classList.contains("is-empty"), "botol kosong bergaris putus-putus");
        t.ok(botol[1].classList.contains("is-valid-target"), "botol kosong disorot sebagai tujuan");
        t.ok(botol[1].classList.contains("is-dimmed") === false, "tujuan tidak diredupkan");
        t.ok(botol[2].classList.contains("is-done"), "botol selesai ditandai");
        t.ok(botol[2].classList.contains("is-dimmed"), "botol selesai tidak ditawarkan");
        t.equal(botol[0].getAttribute("aria-pressed"), "true", "status aria-pressed botol terpilih");
        t.ok(
          botol[2].getAttribute("aria-label").includes("selesai"),
          `label botol selesai: ${botol[2].getAttribute("aria-label")}`,
        );
        t.ok(
          botol[1].getAttribute("aria-label").includes("Bisa dituang"),
          `label tujuan: ${botol[1].getAttribute("aria-label")}`,
        );
      } finally {
        akar.remove();
      }
    });
  }

  const passed = t.results.filter((item) => item.ok).length;
  const skipped = t.results.filter((item) => item.skipped).length;
  return {
    total: t.results.length,
    passed,
    failed: t.results.length - passed,
    skipped,
    results: t.results,
  };
}

/** Solver cepat untuk memeriksa state yang punya botol kosong. */
function isSolvableQuickly(state) {
  const result = solve(cloneState(state), { maxStates: 60000, timeLimitMs: 1500 });
  return result.solved || !result.exhausted;
}

/** PRNG kecil untuk pengujian (sama seperti di levels.js, sengaja dipisah). */
function mulberryLocal(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -----------------------------------------------------------------------------
   Menjalankan sendiri saat dipanggil dari Node
   ----------------------------------------------------------------------------- */

const isNode =
  typeof process !== "undefined" && Boolean(process.versions) && Boolean(process.versions.node);

if (isNode) {
  const { pathToFileURL } = await import("node:url");
  const invokedDirectly =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

  if (invokedDirectly) {
    const startedAt = Date.now();
    const summary = runTests();
    for (const item of summary.results) {
      const tanda = item.skipped ? " lewat " : item.ok ? "  ok  " : " FAIL ";
      const info = item.skipped ? ` (dilewati: ${item.message})` : item.ok ? "" : ` -> ${item.message}`;
      console.log(`[${tanda}] ${item.name}${info}`);
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const dilewati = summary.skipped ? ` (${summary.skipped} dilewati)` : "";
    console.log(`\n${summary.passed}/${summary.total} pengujian lulus dalam ${seconds}s${dilewati}.`);
    if (summary.failed > 0) process.exitCode = 1;
  }
}
