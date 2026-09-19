/**
 * renderer.js — menggambar grid dan animasi ke <canvas>.
 *
 * Modul ini TIDAK mengubah aturan permainan: semua data yang digambar berasal dari
 * state tampilan (view) + event yang sedang dianimasikan. Tidak ada aset gambar
 * eksternal — semua sprite digambar dengan bentuk sederhana.
 */

import { TILES, parseLevel } from "./engine.js";

/** Palet cadangan kalau CSS variable tidak terbaca (mis. saat diuji tanpa CSS). */
const FALLBACK_THEME = {
  floor: "#e8edf8",
  floorAlt: "#dee5f4",
  wall: "#3a4664",
  wallTop: "#4d5a7d",
  rock: "#94a3b8",
  rockDark: "#64748b",
  goal: "#16a34a",
  goalPole: "#475569",
  key: "#f59e0b",
  coin: "#eab308",
  door: "#a16207",
  hero: "#2563eb",
  heroDark: "#1e40af",
  ink: "#0f172a",
  slash: "#f8fafc",
  text: "#0f172a",
};

const EASING = {
  linear: (t) => t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
};

/** Alamat piksel sudut kiri-atas sebuah sel. */
function cellToPixel(row, col, geometry) {
  return {
    x: geometry.offsetX + col * geometry.tile,
    y: geometry.offsetY + row * geometry.tile,
  };
}

/** Menggambar persegi membulat (dengan fallback kalau roundRect tidak ada). */
function roundedRect(ctx, x, y, w, h, radius) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class GridRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.level = null;
    this.parsed = null;
    this.geometry = { tile: 40, offsetX: 0, offsetY: 0, cssWidth: 0, cssHeight: 0 };
    this.theme = { ...FALLBACK_THEME };
    this.maxTile = 76;
  }

  /** Menyiapkan level baru (grid + geometri). */
  setLevel(level) {
    this.level = level;
    this.parsed = parseLevel(level.grid);
    this.readTheme();
    this.resize();
  }

  /** Membaca warna dari CSS variable supaya canvas ikut tema terang/gelap. */
  readTheme() {
    try {
      const styles = getComputedStyle(document.documentElement);
      const read = (name, fallback) => {
        const value = styles.getPropertyValue(name);
        return value && value.trim() ? value.trim() : fallback;
      };
      this.theme = {
        floor: read("--pa-floor", FALLBACK_THEME.floor),
        floorAlt: read("--pa-floor-alt", FALLBACK_THEME.floorAlt),
        wall: read("--pa-wall", FALLBACK_THEME.wall),
        wallTop: read("--pa-wall-top", FALLBACK_THEME.wallTop),
        rock: read("--pa-rock", FALLBACK_THEME.rock),
        rockDark: read("--pa-rock-dark", FALLBACK_THEME.rockDark),
        goal: read("--pa-goal", FALLBACK_THEME.goal),
        goalPole: read("--pa-goal-pole", FALLBACK_THEME.goalPole),
        key: read("--pa-key", FALLBACK_THEME.key),
        coin: read("--pa-coin", FALLBACK_THEME.coin),
        door: read("--pa-door", FALLBACK_THEME.door),
        hero: read("--pa-hero", FALLBACK_THEME.hero),
        heroDark: read("--pa-hero-dark", FALLBACK_THEME.heroDark),
        ink: read("--pa-ink", FALLBACK_THEME.ink),
        slash: read("--pa-slash", FALLBACK_THEME.slash),
        text: read("--pa-text", FALLBACK_THEME.text),
      };
    } catch (error) {
      this.theme = { ...FALLBACK_THEME };
    }
  }

  /** Menyesuaikan ukuran canvas dengan lebar kontainer (grid otomatis). */
  resize() {
    if (!this.parsed || !this.canvas) return;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect?.() ?? { width: 0 };
    const parentWidth = this.canvas.parentElement?.getBoundingClientRect?.().width ?? 0;
    const cssWidth = Math.max(240, Math.round(rect.width || parentWidth || 480));

    const tile = Math.max(16, Math.min(this.maxTile, Math.floor(cssWidth / this.parsed.width)));
    const cssHeight = tile * this.parsed.height;

    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    if (ctx && typeof ctx.setTransform === "function") {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    this.geometry = {
      tile,
      cssWidth,
      cssHeight,
      offsetX: Math.round((cssWidth - tile * this.parsed.width) / 2),
      offsetY: 0,
    };
  }

  /* ---------------------------------------------------------------------------
     Menggambar tile
     --------------------------------------------------------------------------- */

  drawFloor(row, col, view) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(row, col, this.geometry);
    ctx.fillStyle = (row + col) % 2 === 0 ? this.theme.floor : this.theme.floorAlt;
    ctx.fillRect(x, y, tile, tile);
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
    if (TILES.START === view.parsed?.rows[row]?.[col]) {
      ctx.save();
      ctx.strokeStyle = "rgba(37, 99, 235, 0.45)";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + tile * 0.18, y + tile * 0.18, tile * 0.64, tile * 0.64);
      ctx.restore();
    }
  }

  drawWall(row, col) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(row, col, this.geometry);
    ctx.fillStyle = this.theme.wall;
    roundedRect(ctx, x + 1, y + 1, tile - 2, tile - 2, tile * 0.14);
    ctx.fill();
    ctx.fillStyle = this.theme.wallTop;
    ctx.globalAlpha = 0.75;
    const brick = tile / 3;
    for (let i = 1; i < 3; i += 1) {
      ctx.fillRect(x + 2, y + i * brick, tile - 4, 1.5);
    }
    ctx.fillRect(x + tile / 2, y + 2, 1.5, brick);
    ctx.globalAlpha = 1;
  }

  drawRock(row, col, burst) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(row, col, this.geometry);
    const cx = x + tile / 2;
    const cy = y + tile / 2;
    ctx.fillStyle = this.theme.rockDark;
    ctx.beginPath();
    ctx.ellipse(cx, cy + tile * 0.06, tile * 0.34, tile * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.theme.rock;
    ctx.beginPath();
    ctx.ellipse(cx, cy - tile * 0.02, tile * 0.32, tile * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(cx - tile * 0.1, cy - tile * 0.12, tile * 0.09, tile * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    if (burst > 0) {
      ctx.save();
      ctx.globalAlpha = burst;
      ctx.strokeStyle = this.theme.rockDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, tile * (0.3 + (1 - burst) * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawGoal(row, col, time) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(row, col, this.geometry);
    ctx.save();
    ctx.fillStyle = this.theme.goal;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(x + tile / 2, y + tile / 2, tile * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // tiang bendera
    ctx.strokeStyle = this.theme.goalPole;
    ctx.lineWidth = Math.max(2, tile * 0.06);
    ctx.beginPath();
    ctx.moveTo(x + tile * 0.42, y + tile * 0.78);
    ctx.lineTo(x + tile * 0.42, y + tile * 0.22);
    ctx.stroke();

    // bendera melambai mengikuti waktu
    const wave = Math.sin(time / 300) * tile * 0.05;
    ctx.fillStyle = this.theme.goal;
    ctx.beginPath();
    ctx.moveTo(x + tile * 0.42, y + tile * 0.22);
    ctx.lineTo(x + tile * 0.78 + wave, y + tile * 0.34);
    ctx.lineTo(x + tile * 0.42, y + tile * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawKey(row, col) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(row, col, this.geometry);
    ctx.save();
    ctx.strokeStyle = this.theme.key;
    ctx.fillStyle = this.theme.key;
    ctx.lineWidth = Math.max(2, tile * 0.08);
    ctx.beginPath();
    ctx.arc(x + tile * 0.36, y + tile * 0.5, tile * 0.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + tile * 0.5, y + tile * 0.5);
    ctx.lineTo(x + tile * 0.78, y + tile * 0.5);
    ctx.stroke();
    ctx.fillRect(x + tile * 0.68, y + tile * 0.5, tile * 0.06, tile * 0.14);
    ctx.restore();
  }

  drawCoin(row, col, time) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(row, col, this.geometry);
    const scale = 0.34 + Math.sin(time / 240) * 0.03;
    ctx.save();
    ctx.fillStyle = this.theme.coin;
    ctx.beginPath();
    ctx.ellipse(x + tile / 2, y + tile / 2, tile * scale, tile * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 78, 0, 0.6)";
    ctx.lineWidth = Math.max(1, tile * 0.05);
    ctx.stroke();
    ctx.restore();
  }

  drawDoor(row, col) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(row, col, this.geometry);
    ctx.save();
    ctx.fillStyle = this.theme.door;
    roundedRect(ctx, x + tile * 0.18, y + tile * 0.1, tile * 0.64, tile * 0.82, tile * 0.12);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.arc(x + tile * 0.66, y + tile * 0.52, tile * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------------------
     Karakter & efek
     --------------------------------------------------------------------------- */

  /**
   * Menghitung posisi karakter dalam piksel (termasuk animasi gerak & tabrakan).
   */
  heroPosition(view, anim, ghost) {
    const { tile } = this.geometry;
    const source = ghost ?? { row: view.row, col: view.col };

    let row = view.row;
    let col = view.col;
    let offsetX = 0;

    if (anim && anim.type === "move") {
      const t = EASING.easeInOut(Math.min(1, Math.max(0, anim.t)));
      row = source.row + (anim.to.row - source.row) * t;
      col = source.col + (anim.to.col - source.col) * t;
    }
    if (anim && anim.type === "bump") {
      const wobble = Math.sin(Math.min(1, anim.t) * Math.PI * 3) * (1 - anim.t);
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[anim.dir] ?? [0, 0];
      row += delta[0] * 0.18 * wobble;
      col += delta[1] * 0.18 * wobble;
      offsetX = 0;
    }

    const { x, y } = cellToPixel(row, col, this.geometry);
    return { x: x + offsetX, y, cx: x + tile / 2, cy: y + tile / 2 };
  }

  drawHero(view, anim, ghost, time) {
    if (!view || !this.geometry) return;
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const position = this.heroPosition(view, anim, ghost);
    const body = tile * 0.68;    const x = position.cx - body / 2;
    const y = position.cy - body / 2 + Math.sin(time / 400) * tile * 0.02;

    // bayangan
    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.22)";
    ctx.beginPath();
    ctx.ellipse(position.cx, position.y + tile * 0.86, body * 0.42, body * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // badan
    ctx.fillStyle = this.theme.heroDark;
    roundedRect(ctx, x, y + body * 0.1, body, body * 0.9, body * 0.28);
    ctx.fill();
    ctx.fillStyle = this.theme.hero;
    roundedRect(ctx, x, y, body, body * 0.9, body * 0.28);
    ctx.fill();

    // mata sesuai arah hadap (saat animasi berjalan, pakai arah dari event)
    const facing = anim?.facing ?? view.facing ?? "down";
    const eye = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[facing] ?? [0, 1];
    const eyeRadius = body * 0.12;
    const eyeOffset = body * 0.2;
    const lookX = eye[1] * eyeOffset * 0.6;
    const lookY = eye[0] * eyeOffset * 0.6;
    ctx.fillStyle = "#ffffff";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        position.cx + side * eyeOffset * 0.9 + lookX * 0.5,
        position.cy + eyeRadius + lookY * 0.5,
        eyeRadius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = this.theme.ink;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        position.cx + side * eyeOffset * 0.9 + lookX,
        position.cy + eyeRadius + lookY,
        eyeRadius * 0.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // penanda arah hadap kecil di atas kepala
    ctx.fillStyle = this.theme.heroDark;
    ctx.beginPath();
    const tipX = position.cx + eye[1] * body * 0.62;
    const tipY = y - body * 0.1 + eye[0] * body * 0.62;
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - eye[1] * body * 0.12 - eye[0] * body * 0.1, tipY - eye[0] * body * 0.12 - eye[1] * body * 0.1);
    ctx.lineTo(tipX + eye[1] * body * 0.12 - eye[0] * body * 0.1, tipY + eye[0] * body * 0.12 - eye[1] * body * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSlash(anim) {
    if (!anim || anim.type !== "attack" || !anim.target) return;
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const { x, y } = cellToPixel(anim.target.row, anim.target.col, this.geometry);
    const t = Math.min(1, Math.max(0, anim.t));
    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - t);
    ctx.strokeStyle = this.theme.slash;
    ctx.lineWidth = Math.max(2, tile * 0.09);
    ctx.beginPath();
    ctx.arc(x + tile / 2, y + tile / 2, tile * (0.18 + t * 0.42), -0.6, 1.2);
    ctx.stroke();
    ctx.restore();
  }

  drawTexts(texts) {
    const ctx = this.ctx;
    const { tile } = this.geometry;
    for (const item of texts) {
      const { x, y } = cellToPixel(item.row, item.col, this.geometry);
      const t = Math.min(1, Math.max(0, item.t));
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.font = `600 ${Math.max(11, tile * 0.3)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = item.color ?? this.theme.text;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      const textY = y - tile * 0.05 - t * tile * 0.5;
      ctx.strokeText(item.text, x + tile / 2, textY);
      ctx.fillText(item.text, x + tile / 2, textY);
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------------------------
     Gambar utama
     --------------------------------------------------------------------------- */

  /**
   * @param {object} view state tampilan (hasil createView/applyEventToView)
   * @param {{anim?:object, texts?:Array, time?:number, ghost?:object}} [options]
   */
  draw(view, options = {}) {
    if (!this.parsed || !this.ctx || !view) return;
    const ctx = this.ctx;
    const { tile } = this.geometry;
    const time = options.time ?? 0;
    const anim = options.anim ?? null;

    ctx.clearRect(0, 0, this.geometry.cssWidth, this.geometry.cssHeight);

    // latar belakang papan
    ctx.fillStyle = this.theme.floor;
    ctx.fillRect(0, 0, this.geometry.cssWidth, this.geometry.cssHeight);

    const burst = anim && anim.type === "attack" && anim.result === "destroyed" ? 1 - anim.t : 0;

    for (let row = 0; row < view.grid.length; row += 1) {
      for (let col = 0; col < view.grid[row].length; col += 1) {
        const tileChar = view.grid[row][col];
        if (tileChar === TILES.WALL) {
          this.drawWall(row, col);
          continue;
        }
        this.drawFloor(row, col, view);
        if (tileChar === TILES.ROCK) this.drawRock(row, col, burst);
        else if (tileChar === TILES.GOAL) this.drawGoal(row, col, time);
        else if (tileChar === TILES.KEY) this.drawKey(row, col);
        else if (tileChar === TILES.COIN) this.drawCoin(row, col, time);
        else if (tileChar === TILES.DOOR) this.drawDoor(row, col);
      }
    }

    this.drawSlash(anim);
    this.drawHero(view, anim, options.ghost, time);
    this.drawTexts(options.texts ?? []);

    // bingkai papan
    ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, tile * this.parsed.width - 1, tile * this.parsed.height - 1);
  }
}

export { cellToPixel };
