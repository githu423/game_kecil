/**
 * engine.js — state grid, aturan gerak/serang (MURNI, tanpa DOM).
 *
 * Dipakai dua tempat:
 *   1. Di dalam Web Worker, untuk memvalidasi setiap perintah Python dan merekam
 *      daftar event aksi ({type:"move", ok:true, ...}).
 *   2. Di thread utama (opsional) untuk pengujian aturan tanpa Python.
 *
 * Jenis tile:
 *   #  tembok            : tidak bisa dilewati, tidak bisa dihancurkan
 *   .  lantai            : bisa dilewati
 *   R  batu/rintangan    : tidak bisa dilewati, BISA dihancurkan attack()
 *   S  start             : titik awal karakter
 *   G  tujuan (finish)   : tingkatkan bendera di sini untuk menang
 *   K  kunci             : bisa dilewati, diambil otomatis
 *   D  pintu             : butuh kunci untuk dibuka (kunci terpakai)
 *   C  koin              : bisa dilewati, bonus
 */

export const TILES = Object.freeze({
  WALL: "#",
  FLOOR: ".",
  ROCK: "R",
  START: "S",
  GOAL: "G",
  KEY: "K",
  DOOR: "D",
  COIN: "C",
});

/** Arah yang dikenal (sesuai API Python). */
export const DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);

/** Perubahan baris/kolom untuk setiap arah. */
export const DELTAS = Object.freeze({
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
});

/** Tile yang bisa dilewati karakter. */
const WALKABLE = new Set([TILES.FLOOR, TILES.START, TILES.GOAL, TILES.KEY, TILES.COIN]);

/** true kalau arah termasuk arah yang sah. */
export function isValidDirection(direction) {
  return DIRECTIONS.includes(direction);
}

/**
 * Membaca level dari bentuk array string menjadi data yang siap dipakai.
 * @param {string[]} rows
 * @returns {{rows: string[][], width: number, height: number, start: {row:number,col:number}, goal: {row:number,col:number}}}
 */
export function parseLevel(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Level harus berisi minimal satu baris.");
  }
  const width = rows[0].length;
  const grid = rows.map((line) => {
    if (line.length !== width) throw new Error("Semua baris level harus sama panjang.");
    return line.split("");
  });

  let start = null;
  let goal = null;
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const tile = grid[row][col];
      if (tile === TILES.START) {
        if (start) throw new Error("Level hanya boleh punya satu titik start (S).");
        start = { row, col };
      } else if (tile === TILES.GOAL) {
        if (goal) throw new Error("Level hanya boleh punya satu tujuan (G).");
        goal = { row, col };
      }
    }
  }
  if (!start) throw new Error("Level tidak punya titik start (S).");
  if (!goal) throw new Error("Level tidak punya tujuan (G).");

  return { rows: grid, width, height: grid.length, start, goal };
}

/**
 * Mesin permainan satu level.
 * Semua aksi menambah entri ke `this.events` supaya bisa diputar ulang sebagai animasi.
 */
export class GameEngine {
  /**
   * @param {{grid: string[], facing?: string}} level
   */
  constructor(level) {
    this.level = level;
    this.parsed = parseLevel(level.grid);
    this.initialFacing = isValidDirection(level.facing) ? level.facing : "down";
    this.reset();
  }

  /** Mengembalikan state ke kondisi awal level. */
  reset() {
    this.grid = this.parsed.rows.map((line) => line.slice());
    this.row = this.parsed.start.row;
    this.col = this.parsed.start.col;
    this.facing = this.initialFacing;
    this.keys = 0;
    this.coins = 0;
    this.actionCount = 0;
    this.events = [];
  }

  /** true jika koordinat ada di dalam peta. */
  inBounds(row, col) {
    return row >= 0 && row < this.parsed.height && col >= 0 && col < this.parsed.width;
  }

  /** Tile pada koordinat (null kalau di luar peta). */
  tileAt(row, col) {
    if (!this.inBounds(row, col)) return null;
    return this.grid[row][col];
  }

  /** Koordinat tile di depan karakter untuk arah tertentu. */
  ahead(direction) {
    const delta = DELTAS[direction];
    if (!delta) return null;
    return { row: this.row + delta.row, col: this.col + delta.col };
  }

  /**
   * Bisa dilewati atau tidak (tanpa mengubah state).
   * Pintu bisa dilewati hanya kalau pemain punya kunci.
   */
  canEnter(direction) {
    const target = this.ahead(direction);
    if (!target) return false;
    const tile = this.tileAt(target.row, target.col);
    if (tile === null) return false;
    if (tile === TILES.DOOR) return this.keys > 0;
    return WALKABLE.has(tile);
  }

  /** Sensor is_blocked(): true kalau tile di arah itu tidak bisa dilewati. */
  isBlocked(direction) {
    return !this.canEnter(direction);
  }

  /** Sensor can_attack(): true kalau tile di arah itu batu yang bisa dihancurkan. */
  canAttack(direction) {
    const target = this.ahead(direction);
    if (!target) return false;
    return this.tileAt(target.row, target.col) === TILES.ROCK;
  }

  /** Sudah sampai tujuan? */
  atGoal() {
    return this.row === this.parsed.goal.row && this.col === this.parsed.goal.col;
  }

  /** Ringkasan state (dipakai renderer & event). */
  snapshot() {
    return {
      row: this.row,
      col: this.col,
      facing: this.facing,
      keys: this.keys,
      coins: this.coins,
      grid: this.grid.map((line) => line.join("")),
    };
  }

  /** Mencatat event ke daftar yang akan diputar sebagai animasi. */
  record(event) {
    const snapshot = this.snapshot();
    const entry = {
      ...event,
      row: snapshot.row,
      col: snapshot.col,
      facing: snapshot.facing,
      keys: snapshot.keys,
      coins: snapshot.coins,
      grid: snapshot.grid,
      reachedGoal: this.atGoal(),
      actionCount: ++this.actionCount,
    };
    this.events.push(entry);
    return entry;
  }

  /**
   * Bergerak satu tile. Arah hadap selalu diperbarui (termasuk saat gerakan gagal),
   * supaya pemain bisa "menoleh" dengan memanggil move_* walau terhalang.
   */
  move(direction) {
    if (!isValidDirection(direction)) {
      throw new Error(`Arah tidak dikenal: ${direction}`);
    }
    this.facing = direction;

    const target = this.ahead(direction);
    const tile = target ? this.tileAt(target.row, target.col) : null;

    if (tile === null || !this.canEnter(direction)) {
      // Gagal jalan: bukan crash, hanya "menabrak".
      let blockedBy = "wall";
      if (tile === null) blockedBy = "edge";
      else if (tile === TILES.ROCK) blockedBy = "rock";
      else if (tile === TILES.DOOR) blockedBy = "door";
      return this.record({ type: "move", dir: direction, ok: false, blockedBy, collected: null, opened: null });
    }

    this.row = target.row;
    this.col = target.col;

    let collected = null;
    let opened = null;
    if (tile === TILES.KEY) {
      this.keys += 1;
      collected = { row: this.row, col: this.col, type: "key" };
      this.grid[this.row][this.col] = TILES.FLOOR;
    } else if (tile === TILES.COIN) {
      this.coins += 1;
      collected = { row: this.row, col: this.col, type: "coin" };
      this.grid[this.row][this.col] = TILES.FLOOR;
    } else if (tile === TILES.DOOR) {
      this.keys -= 1;
      opened = { row: this.row, col: this.col };
      this.grid[this.row][this.col] = TILES.FLOOR;
    }

    return this.record({ type: "move", dir: direction, ok: true, blockedBy: null, collected, opened });
  }

  /**
   * Menyerang tile di depan.
   * @param {string} [direction] arah serangan; default arah hadap terakhir.
   */
  attack(direction = this.facing) {
    if (!isValidDirection(direction)) {
      throw new Error(`Arah tidak dikenal: ${direction}`);
    }
    this.facing = direction;
    const target = this.ahead(direction);
    const tile = target ? this.tileAt(target.row, target.col) : null;

    if (tile === null) {
      return this.record({ type: "attack", dir: direction, ok: true, target: null, result: "outside" });
    }
    if (tile === TILES.ROCK) {
      this.grid[target.row][target.col] = TILES.FLOOR;
      return this.record({
        type: "attack",
        dir: direction,
        ok: true,
        target,
        result: "destroyed",
      });
    }
    if (tile === TILES.DOOR) {
      return this.record({ type: "attack", dir: direction, ok: true, target, result: "door" });
    }
    if (tile === TILES.WALL) {
      return this.record({ type: "attack", dir: direction, ok: true, target, result: "wall" });
    }
    return this.record({ type: "attack", dir: direction, ok: true, target, result: "empty" });
  }
}

/**
 * Menerapkan satu event hasil rekaman ke state tampilan (dipakai thread utama
 * saat memutar animasi, tanpa validasi ulang aturan).
 */
export function applyEventToView(view, event) {
  view.row = event.row;
  view.col = event.col;
  view.facing = event.facing;
  view.keys = event.keys;
  view.coins = event.coins;
  view.grid = event.grid.map((line) => line.split(""));
  if (event.type === "attack" && event.result === "destroyed" && event.target) {
    view.grid[event.target.row][event.target.col] = TILES.FLOOR;
  }
  return view;
}

/** State tampilan awal dari sebuah level. */
export function createView(level) {
  const parsed = parseLevel(level.grid);
  const view = {
    row: parsed.start.row,
    col: parsed.start.col,
    facing: isValidDirection(level.facing) ? level.facing : "down",
    keys: 0,
    coins: 0,
    grid: parsed.rows.map((line) => line.slice()),
    parsed,
  };
  return view;
}
