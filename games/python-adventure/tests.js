/**
 * tests.js — pengujian engine Python Adventure tanpa Python (aturan gerak, serang,
 * sensor, kunci/pintu, dan validasi data level).
 *
 * Dijalankan dari Node (dari akar repo):
 *   node games/python-adventure/tests.js
 *
 * Berkas ini menguji aturan tanpa Python, jadi bisa jalan di Node tanpa Pyodide.
 * Solusi referensi tiap level diuji terpisah memakai Pyodide asli (lihat README,
 * bagian "Cara menguji"), dan lewat halaman permainan di browser.
 */

import { DIRECTIONS, GameEngine, TILES, applyEventToView, createView, parseLevel } from "./engine.js";
import { LEVELS, LEVEL_COUNT, getLevel, listLevels } from "./levels.js";
import {
  LOAD_LIMITS,
  LIMITS,
  PYODIDE_FILES,
  PYODIDE_SOURCES,
  PYODIDE_TOTAL_BYTES,
  PYODIDE_VERSION,
  PYTHON_PRELUDE,
  PyodideLoadError,
  formatBytes,
  parsePythonError,
  prefetchSource,
} from "./runner.js";

/* -----------------------------------------------------------------------------
   Kerangka pengujian ringkas (sama gaya dengan Water Sort)
   ----------------------------------------------------------------------------- */

function makeReporter() {
  const results = [];
  const pending = [];
  return {
    results,
    // Mendukung pengujian sinkron maupun async; hasil tetap dicatat berurutan.
    check(name, fn) {
      try {
        const hasil = fn();
        if (hasil && typeof hasil.then === "function") {
          pending.push(
            hasil.then(
              () => results.push({ name, ok: true, message: "" }),
              (error) => results.push({ name, ok: false, message: error?.message ?? String(error) }),
            ),
          );
          return;
        }
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
    /** Menunggu semua pengujian async selesai sebelum ringkasan dihitung. */
    async done() {
      await Promise.all(pending);
    },
  };
}

/** Membuat engine dari grid sederhana. */
function makeEngine(grid, facing = "down") {
  return new GameEngine({ grid, facing });
}

/* -----------------------------------------------------------------------------
   Pengujian
   ----------------------------------------------------------------------------- */

/**
 * Menjalankan semua pengujian engine + validasi level.
 * @returns {{total:number, passed:number, failed:number, results:Array<{name:string, ok:boolean, message:string}>}}
 */
export async function runEngineTests() {
  const t = makeReporter();

  /* ---------------- data level ---------------- */

  t.check("level: minimal 15 level, id berurutan, punya judul & instruksi", () => {
    t.ok(LEVEL_COUNT >= 15, "jumlah level");
    LEVELS.forEach((level, index) => {
      t.equal(level.id, index + 1, "id level");
      t.ok(level.title.length > 0, `judul level ${level.id}`);
      t.ok(level.instruction.length > 0, `instruksi level ${level.id}`);
      t.ok(level.hint.length > 0, `petunjuk level ${level.id}`);
      t.ok(typeof level.solution === "string" && level.solution.length > 0, `solusi referensi level ${level.id}`);
    });
    t.equal(listLevels().length, LEVEL_COUNT, "daftar level");
  });

  t.check("level: grid persegi, ada satu S dan satu G, tile dikenal", () => {
    const known = new Set(Object.values(TILES));
    for (const level of LEVELS) {
      const width = level.grid[0].length;
      let start = 0;
      let goal = 0;
      for (const row of level.grid) {
        if (row.length !== width) throw new Error(`level ${level.id}: baris tidak sama panjang`);
        for (const char of row) {
          if (!known.has(char)) throw new Error(`level ${level.id}: tile tidak dikenal "${char}"`);
          if (char === TILES.START) start += 1;
          if (char === TILES.GOAL) goal += 1;
        }
      }
      t.equal(start, 1, `jumlah S level ${level.id}`);
      t.equal(goal, 1, `jumlah G level ${level.id}`);
    }
  });

  t.check("level: tujuan selalu bisa dicapai (batu dianggap bisa dihancurkan)", () => {
    for (const level of LEVELS) {
      const parsed = parseLevel(level.grid);
      const seen = new Set();
      const queue = [parsed.start];
      let reached = false;
      while (queue.length) {
        const current = queue.shift();
        const key = `${current.row},${current.col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (current.row === parsed.goal.row && current.col === parsed.goal.col) {
          reached = true;
          break;
        }
        for (const direction of DIRECTIONS) {
          const delta = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[direction];
          const row = current.row + delta[0];
          const col = current.col + delta[1];
          if (row < 0 || row >= parsed.height || col < 0 || col >= parsed.width) continue;
          const tile = parsed.rows[row][col];
          // Tembok tetap tembok; batu/pintu dianggap bisa dilewati (dihancurkan/dibuka).
          if (tile === TILES.WALL) continue;
          queue.push({ row, col });
        }
      }
      t.ok(reached, `level ${level.id} punya jalur ke tujuan`);
    }
  });

  t.check("level: kunci dan pintu dipakai bersama", () => {
    const keyCount = LEVELS.reduce((sum, l) => sum + l.grid.join("").split(TILES.KEY).length - 1, 0);
    const doorCount = LEVELS.reduce((sum, l) => sum + l.grid.join("").split(TILES.DOOR).length - 1, 0);
    t.ok(keyCount >= 1 && doorCount >= 1, "ada kunci dan pintu di level lanjutan");
    t.equal(getLevel(999).id, 1, "getLevel aman untuk id tak dikenal");
  });

  /* ---------------- aturan gerak ---------------- */

  t.check("gerak: pindah ke lantai kosong", () => {
    const engine = makeEngine(["#####", "#S.G#", "#####"]);
    const event = engine.move("right");
    t.ok(event.ok, "gerakan berhasil");
    t.equal(engine.row, 1, "baris");
    t.equal(engine.col, 2, "kolom");
    t.equal(engine.facing, "right", "arah hadap");
  });

  t.check("gerak: menabrak tembok tidak pindah tapi arah hadap berubah", () => {
    const engine = makeEngine(["#####", "#S.G#", "#####"]);
    const event = engine.move("up");
    t.notOk(event.ok, "gerakan gagal");
    t.equal(event.blockedBy, "wall", "penyebab");
    t.equal(engine.row, 1, "baris tetap");
    t.equal(engine.col, 1, "kolom tetap");
    t.equal(engine.facing, "up", "arah hadap berubah");
  });

  t.check("gerak: batu menghalangi", () => {
    const engine = makeEngine(["#####", "#SRG#", "#####"]);
    const event = engine.move("right");
    t.notOk(event.ok, "gerakan gagal");
    t.equal(event.blockedBy, "rock", "penyebab");
    t.ok(engine.isBlocked("right"), "sensor is_blocked");
    t.ok(engine.canAttack("right"), "sensor can_attack");
  });

  t.check("gerak: keluar peta dianggap terhalang", () => {
    const engine = makeEngine(["#####", "#S.G#", "#####"]);
    const event = engine.move("left");
    t.notOk(event.ok, "gerakan gagal");
    t.equal(event.blockedBy, "wall", "penyebab (tembok batas)");
  });

  /* ---------------- serangan ---------------- */

  t.check("serang: batu hancur dan tile menjadi lantai", () => {
    const engine = makeEngine(["#####", "#SRG#", "#####"], "right");
    const event = engine.attack();
    t.equal(event.result, "destroyed", "hasil serangan");
    t.equal(engine.tileAt(1, 2), TILES.FLOOR, "tile jadi lantai");
    t.ok(engine.canEnter("right"), "jalan terbuka");
  });

  t.check("serang: tembok tidak mempan", () => {
    const engine = makeEngine(["#####", "#S#G#", "#####"], "right");
    const event = engine.attack();
    t.equal(event.result, "wall", "hasil serangan ke tembok");
    t.equal(engine.tileAt(1, 2), TILES.WALL, "tembok tetap ada");
  });

  t.check("serang: pakai arah hadap terakhir kalau tanpa argumen", () => {
    const engine = makeEngine(["#####", "#S.#.", "#RG#.", "#####"], "down");
    // Arah hadap awal 'down' -> batu di bawah hancur.
    const event = engine.attack();
    t.equal(event.dir, "down", "arah serangan");
    t.equal(event.result, "destroyed", "hasil");
  });

  t.check("serang: bisa memakai arah eksplisit", () => {
    const engine = makeEngine(["#####", "#SRG#", "#####"], "up");
    const event = engine.attack("right");
    t.equal(event.dir, "right", "arah serangan");
    t.equal(engine.facing, "right", "arah hadap ikut berubah");
  });

  /* ---------------- sensor & tujuan ---------------- */

  t.check("sensor: is_blocked, can_attack, at_goal", () => {
    const engine = makeEngine(["#####", "#SRG#", "#####"]);
    t.ok(engine.isBlocked("right"), "kanan terhalang batu");
    t.ok(engine.isBlocked("up"), "atas tembok batas");
    t.notOk(engine.atGoal(), "belum di tujuan");
    engine.move("right"); // gagal, hanya menoleh
    engine.attack("right");
    engine.move("right");
    engine.move("right");
    t.ok(engine.atGoal(), "sampai tujuan");
  });

  t.check("kunci & pintu: pintu terkunci tanpa kunci", () => {
    const engine = makeEngine(["#######", "#SDG#.#", "#######"]);
    const blocked = engine.move("right");
    t.notOk(blocked.ok, "gerakan gagal");
    t.equal(blocked.blockedBy, "door", "penyebab: pintu");
    t.ok(engine.keys === 0, "tidak punya kunci");
  });

  t.check("kunci & pintu: kunci membuka pintu lalu terpakai", () => {
    const engine = makeEngine(["#######", "#SKDG.#", "#######"]);
    const takeKey = engine.move("right");
    t.ok(takeKey.ok, "ambil kunci");
    t.equal(engine.keys, 1, "jumlah kunci");
    t.equal(engine.tileAt(1, 2), TILES.FLOOR, "kunci hilang dari peta");
    const openDoor = engine.move("right");
    t.ok(openDoor.ok, "pintu terbuka");
    t.equal(engine.keys, 0, "kunci terpakai");
    t.equal(engine.tileAt(1, 3), TILES.FLOOR, "pintu menjadi lantai");
  });

  t.check("koin: diambil sebagai bonus", () => {
    const engine = makeEngine(["#####", "#SCG#", "#####"]);
    engine.move("right");
    t.equal(engine.coins, 1, "koin terkumpul");
    t.equal(engine.tileAt(1, 2), TILES.FLOOR, "koin hilang dari peta");
  });

  /* ---------------- event & replay ---------------- */

  t.check("event: setiap aksi tercatat lengkap", () => {
    const engine = makeEngine(["#####", "#SRG#", "#####"], "right");
    engine.move("right"); // gagal (batu), hanya menoleh
    engine.attack();
    engine.move("right");
    engine.move("right");
    t.equal(engine.events.length, 4, "jumlah event");
    const attack = engine.events[1];
    t.equal(attack.type, "attack", "jenis event");
    t.equal(attack.result, "destroyed", "hasil");
    t.ok(Array.isArray(attack.grid), "grid ikut direkam");
    t.ok(engine.events[3].reachedGoal, "event terakhir sudah di tujuan");
  });

  t.check("replay: applyEventToView mengikuti event terakhir", () => {
    const level = { grid: ["#####", "#SRG#", "#####"], facing: "right" };
    const engine = new GameEngine(level);
    engine.attack();
    engine.move("right");
    engine.move("right");

    const view = createView(level);
    for (const event of engine.events) applyEventToView(view, event);

    t.equal(view.row, engine.row, "baris akhir");
    t.equal(view.col, engine.col, "kolom akhir");
    t.equal(view.grid[1][2], TILES.FLOOR, "batu sudah hilang di view");
    t.equal(view.facing, "right", "arah hadap");
  });

  t.check("reset: engine bisa dipakai ulang dari kondisi awal", () => {
    const level = { grid: ["#####", "#SRG#", "#####"], facing: "right" };
    const engine = new GameEngine(level);
    engine.attack();
    engine.move("right");
    engine.reset();
    t.equal(engine.row, level.grid.indexOf("#SRG#") === 1 ? 1 : engine.row, "baris awal");
    t.equal(engine.col, 1, "kolom awal");
    t.equal(engine.actionCount, 0, "penghitung aksi");
    t.equal(engine.events.length, 0, "daftar event kosong");
    t.equal(engine.tileAt(1, 2), TILES.ROCK, "batu kembali");
  });

  t.check("parseLevel: menolak level tanpa start atau tujuan", () => {
    let gagal = 0;
    try {
      parseLevel(["###", "#.#", "###"]);
    } catch (error) {
      gagal += 1;
    }
    try {
      parseLevel(["###", "#S#", "###"]);
    } catch (error) {
      gagal += 1;
    }
    t.equal(gagal, 2, "dua level tidak sah ditolak");
  });

  /* ------------------------- pemuatan Pyodide (tanpa jaringan) ------------------------- */

  t.check("Pyodide: versi dipin dan urutan sumber (lokal lebih dulu)", () => {
    t.equal(PYODIDE_VERSION, "314.0.7", "versi dipin");
    t.equal(PYODIDE_SOURCES[0].id, "lokal", "sumber pertama");
    t.ok(PYODIDE_SOURCES[0].indexURL.endsWith("vendor/pyodide/"), "sumber lokal = vendor/pyodide/");
    t.ok(PYODIDE_SOURCES[0].indexURL.endsWith("/vendor/pyodide/"), "berakhir di vendor/pyodide/");
    t.equal(PYODIDE_SOURCES[1].id, "jsdelivr", "cadangan pertama");
    t.ok(PYODIDE_SOURCES[1].indexURL.includes(`/v${PYODIDE_VERSION}/full/`), "folder CDN jsDelivr");
    t.equal(PYODIDE_SOURCES[2].id, "unpkg", "cadangan kedua");
    t.ok(PYODIDE_SOURCES[2].indexURL.includes(`pyodide@${PYODIDE_VERSION}`), "versi di unpkg");
  });

  t.check("Pyodide: daftar berkas + total byte sesuai rilis 314.0.7", () => {
    const nama = PYODIDE_FILES.map((file) => file.name);
    t.equal(nama, ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide.asm.mjs", "pyodide-lock.json"], "berkas");
    t.equal(PYODIDE_FILES[0].bytes, 9598218, "ukuran wasm");
    t.equal(
      PYODIDE_TOTAL_BYTES,
      PYODIDE_FILES.reduce((total, file) => total + file.bytes, 0),
      "total = jumlah berkas",
    );
    t.ok(PYODIDE_TOTAL_BYTES > 13000000 && PYODIDE_TOTAL_BYTES < 14000000, "total sekitar 13,5 MB");
  });

  t.check("formatBytes: teks Indonesia dengan koma", () => {
    t.equal(formatBytes(950), "950 B", "byte");
    t.equal(formatBytes(119077), "119,1 kB", "kilobyte");
    t.equal(formatBytes(4200000), "4,2 MB", "megabyte");
    t.equal(formatBytes(PYODIDE_TOTAL_BYTES), "13,5 MB", "total unduhan");
  });

  t.check("batas waktu pemuatan wajar (tidak menggantung selamanya)", () => {
    t.equal(LOAD_LIMITS.totalTimeoutMs, 45000, "batas total 45 detik");
    t.ok(LOAD_LIMITS.stallTimeoutMs < LOAD_LIMITS.totalTimeoutMs, "batas macet lebih pendek");
    t.ok(LOAD_LIMITS.readyTimeoutMs > LOAD_LIMITS.totalTimeoutMs, "pengaman worker di atas batas total");
    t.ok(LOAD_LIMITS.stallTimeoutMs >= 5000, "batas macet tidak terlalu ketat");
  });

  t.check("prefetchSource: melaporkan progres byte yang nyata", async () => {
    const dikunjungi = [];
    const fetchImpl = async (url) => {
      dikunjungi.push(url);
      const ukuran = 1000; // berkas tiruan: 1000 byte
      return new Response(new Uint8Array(ukuran), {
        status: 200,
        headers: { "content-length": String(ukuran) },
      });
    };
    const progres = [];
    const total = await prefetchSource(
      { id: "uji", label: "uji", indexURL: "http://contoh.test/" },
      { fetchImpl, onProgress: (info) => progres.push(info) },
    );
    t.equal(dikunjungi.length, PYODIDE_FILES.length, "semua berkas besar diunduh");
    t.equal(total, 1000 * PYODIDE_FILES.length, "total byte terbaca");
    t.equal(progres.length, PYODIDE_FILES.length, "progres dilaporkan per berkas");
    t.equal(progres.at(-1).total, PYODIDE_TOTAL_BYTES, "pembagi persen = perkiraan total");
    t.ok(progres.at(-1).received > progres[0].received, "byte bertambah");
  });

  t.check("prefetchSource: berkas tidak ada → error jelas (bukan menggantung)", async () => {
    const fetchImpl = async (url) => new Response("tidak ada", { status: 404 });
    let pesan = "";
    try {
      await prefetchSource({ id: "uji", label: "uji", indexURL: "http://contoh.test/" }, { fetchImpl });
    } catch (error) {
      pesan = String(error.message);
    }
    t.ok(pesan.includes("404"), `pesan error: ${pesan}`);
  });

  t.check("PyodideLoadError: laporan teknis menyebut tiap sumber", () => {
    const error = new PyodideLoadError("semua gagal", [
      { id: "lokal", label: "salinan lokal", ok: false, ms: 12, error: "HTTP 404" },
      { id: "jsdelivr", label: "CDN jsDelivr", ok: true, ms: 800 },
    ]);
    const laporan = error.technicalReport();
    t.ok(laporan.includes("salinan lokal") && laporan.includes("HTTP 404"), "percobaan gagal muncul");
    t.ok(laporan.includes("CDN jsDelivr") && laporan.includes("berhasil"), "percobaan berhasil muncul");
    t.equal(error.name, "PyodideLoadError", "nama error");
  });

  t.check("prelude: move_* menerima jumlah langkah (move_down(2))", () => {
    for (const nama of ["move_up", "move_down", "move_left", "move_right"]) {
      t.ok(PYTHON_PRELUDE.includes(`def ${nama}(langkah=1):`), `${nama}(langkah=1)`);
    }
    t.ok(PYTHON_PRELUDE.includes("_MAKS_LANGKAH = 50"), "batas 50 langkah per perintah");
    t.ok(PYTHON_PRELUDE.includes("class ArgumenError(Exception)"), "error argumen khusus");
    t.ok(PYTHON_PRELUDE.includes("if not __api_move__(arah, baris):"), "berhenti saat tertabrak");
    t.ok(PYTHON_PRELUDE.includes("isinstance(langkah, bool)"), "True/False ditolak sebagai angka");
    t.ok(PYTHON_PRELUDE.includes("move_down(2)"), "contoh di bantuan()");
  });

  t.check("ArgumenError diterjemahkan ke pesan Indonesia + nomor baris", () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "<kodemu>", line 3, in <module>',
      '    move_down(0)',
      '  File "<sistem>", line 61, in move_down',
      '    _gerak("down", langkah, "move_down", _inspect.currentframe().f_back.f_lineno)',
      'ArgumenError: Jumlah langkah pada move_down() minimal 1, contoh: move_down(1).',
    ].join("\n");
    const parsed = parsePythonError(traceback);
    t.equal(parsed.type, "ArgumenError", "jenis error");
    t.equal(parsed.line, 3, "nomor baris kode pemain");
    t.ok(parsed.friendly.includes("minimal 1"), `pesan ramah: ${parsed.friendly}`);
    t.ok(!parsed.friendly.includes("Traceback"), "pesan ramah tidak menampilkan traceback");
  });

  t.check("batas aksi tetap 500 dan berlaku per langkah", () => {
    t.equal(LIMITS.maxActions, 500, "batas aksi");
    t.equal(LIMITS.timeoutMs, 5000, "batas waktu 5 detik");
  });

  await t.done(); // pengujian pemuatan Pyodide berjalan async
  const passed = t.results.filter((item) => item.ok).length;
  return {
    total: t.results.length,
    passed,
    failed: t.results.length - passed,
    results: t.results,
  };
}

/* -----------------------------------------------------------------------------
   Auto-run di Node
   ----------------------------------------------------------------------------- */

const isNode =
  typeof process !== "undefined" && Boolean(process.versions) && Boolean(process.versions.node);

if (isNode) {
  const { pathToFileURL } = await import("node:url");
  const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

  if (invokedDirectly) {
    const summary = await runEngineTests();
    for (const item of summary.results) {
      console.log(`[${item.ok ? "  ok  " : " FAIL "}] ${item.name}${item.ok ? "" : ` -> ${item.message}`}`);
    }
    console.log(`\n${summary.passed}/${summary.total} pengujian lulus.`);
    if (summary.failed > 0) process.exitCode = 1;
  }
}
