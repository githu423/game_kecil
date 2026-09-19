/**
 * portal.js — halaman menu portal.
 *
 * Daftar game berasal dari satu array konfigurasi (GAMES) supaya menambah game baru
 * cukup menambah satu objek. Tidak ada framework: kartu dibuat dengan DOM API biasa.
 */

/* -----------------------------------------------------------------------------
   Konfigurasi game
   ----------------------------------------------------------------------------- */

/**
 * Menambah game baru = menambah satu objek di array ini.
 * @typedef {object} GameConfig
 * @property {string} id            - id unik (dipakai untuk kunci penyimpanan progres)
 * @property {string} title         - judul di kartu
 * @property {string} icon          - emoji ikon (tanpa aset gambar eksternal)
 * @property {string} tagline       - satu baris penjelasan gaya
 * @property {string} description   - deskripsi singkat
 * @property {string} url           - path RELATIF ke halaman game
 * @property {string[]} tags        - label kecil di kartu
 * @property {string} accent        - nama aksen warna di portal.css ("teal", "violet", ...)
 * @property {{key: string, unit: string, total: number}} progress - info pembacaan progres
 */

/** @type {GameConfig[]} */
export const GAMES = [
  {
    id: "water-sort",
    title: "Water Sort",
    icon: "🧪",
    tagline: "Puzzle mengurutkan cairan warna",
    description:
      "Pindahkan cairan antar botol sampai setiap botol berisi satu warna saja. " +
      "Ada 20 level bertingkat, mode acak, tombol undo tanpa batas, dan petunjuk " +
      "otomatis dari solver. Tersedia mode aksesibel untuk pemain buta warna.",
    url: "./games/water-sort/index.html",
    tags: ["Puzzle", "20 level + acak", "Tanpa library"],
    accent: "teal",
    progress: { key: "watersort.progress.v1", unit: "level tertinggi", total: 20 },
  },
  {
    id: "python-adventure",
    title: "Python Adventure",
    icon: "🐍",
    tagline: "Kendalikan karakter dengan kode Python asli",
    description:
      "Tulis kode Python untuk menggerakkan karakter, menghancurkan batu, dan " +
      "mencapai tujuan. Python dijalankan langsung di browser lewat Pyodide " +
      "(Web Worker), jadi kamu sekaligus belajar perulangan, kondisi, dan fungsi.",
    url: "./games/python-adventure/index.html",
    tags: ["Belajar Python", "15 level", "Pyodide di CDN"],
    accent: "violet",
    progress: { key: "pythonadventure.progress.v1", unit: "level tertinggi", total: 15 },
  },
];

/* -----------------------------------------------------------------------------
   Helper penyimpanan (selalu dibungkus try/catch)
   ----------------------------------------------------------------------------- */

/** Membaca JSON dari localStorage tanpa pernah melempar error. */
function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null; // localStorage bisa diblokir (mode privat, iframe, dsb.)
  }
}

/** Menulis JSON ke localStorage tanpa pernah melempar error. */
function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

/* -----------------------------------------------------------------------------
   Tema (auto → gelap → terang), mengikuti prefers-color-scheme pada mode auto
   ----------------------------------------------------------------------------- */

const THEME_KEY = "gameportal.theme.v1";
const THEMES = [
  { id: "auto", label: "Tema: ikut sistem", icon: "🌗", value: null },
  { id: "dark", label: "Tema: gelap", icon: "🌙", value: "dark" },
  { id: "light", label: "Tema: terang", icon: "☀️", value: "light" },
];

/**
 * Memasang tombol pengubah tema.
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} labelEl
 * @param {HTMLElement} iconEl
 */
export function setupThemeToggle(button, labelEl, iconEl) {
  let index = Math.max(
    0,
    THEMES.findIndex((theme) => theme.id === (readJson(THEME_KEY)?.id ?? "auto")),
  );

  const apply = () => {
    const theme = THEMES[index];
    const root = document.documentElement;
    if (theme.value) {
      root.setAttribute("data-theme", theme.value);
    } else {
      root.removeAttribute("data-theme");
    }
    if (labelEl) labelEl.textContent = theme.label;
    if (iconEl) iconEl.textContent = theme.icon;
    button.setAttribute("aria-label", `${theme.label}. Klik untuk mengganti tema.`);
    writeJson(THEME_KEY, { id: theme.id });
  };

  button.addEventListener("click", () => {
    index = (index + 1) % THEMES.length;
    apply();
  });

  apply();
}

/* -----------------------------------------------------------------------------
   Render kartu game
   ----------------------------------------------------------------------------- */

/** Membuat elemen dengan atribut dan anak secara ringkas. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

/**
 * Mengubah data progres menjadi kalimat singkat untuk kartu.
 * Game menulis { highest, completed } — `completed` berisi daftar level yang tamat,
 * jadi "selesai semua" hanya muncul kalau benar-benar semua level ditamatkan.
 */
function progressText(config) {
  const data = readJson(config.progress.key);
  const highest = Number(data?.highest) || 0;
  const completed = Array.isArray(data?.completed) ? data.completed.length : 0;
  if (completed >= config.progress.total) return `Selesai semua (${config.progress.total} level)`;
  if (highest <= 0) return "Belum dimainkan";
  return `${config.progress.unit}: ${highest} dari ${config.progress.total}`;
}

/** Membuat satu kartu game. */
function renderCard(config) {
  const titleId = `game-${config.id}-title`;

  const card = el("li", {
    class: "game-card",
    "data-accent": config.accent,
    "aria-labelledby": titleId,
  });

  card.append(
    el("div", { class: "game-card__head" }, [
      el("span", { class: "game-card__icon", "aria-hidden": "true", text: config.icon }),
      el("div", {}, [
        el("h3", { class: "game-card__title", id: titleId, text: config.title }),
        el("p", { class: "game-card__tagline", text: config.tagline }),
      ]),
    ]),
    el("p", { class: "game-card__desc", text: config.description }),
    el(
      "ul",
      { class: "game-card__tags" },
      config.tags.map((tag) => el("li", { text: tag })),
    ),
  );

  const playLink = el("a", {
    class: "btn game-card__play",
    href: config.url,
    text: "Main ▶",
  });
  playLink.setAttribute("aria-label", `Main ${config.title}`);

  card.append(
    el("div", { class: "game-card__footer" }, [
      el("span", { class: "game-card__progress", text: progressText(config) }),
      playLink,
    ]),
  );

  return card;
}

/** Merender seluruh daftar game ke dalam <ul id="gameList">. */
export function renderGameList(listElement, games = GAMES) {
  if (!listElement) return;
  listElement.replaceChildren(...games.map(renderCard));
}

/* -----------------------------------------------------------------------------
   Inisialisasi halaman
   ----------------------------------------------------------------------------- */

function init() {
  renderGameList(document.getElementById("gameList"));

  const themeButton = document.getElementById("themeToggle");
  if (themeButton) {
    setupThemeToggle(
      themeButton,
      document.getElementById("themeLabel"),
      document.getElementById("themeIcon"),
    );
  }

  // Perbarui progres setiap kali tab kembali aktif (mis. setelah selesai main).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renderGameList(document.getElementById("gameList"));
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
