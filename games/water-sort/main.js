/**
 * main.js — tampilan & interaksi Water Sort.
 *
 * Tugas berkas ini hanya menghubungkan aturan di logic.js dengan DOM:
 *   - menggambar botol (DOM, bukan canvas, supaya animasi CSS mudah),
 *   - menangani klik/ketuk (pilih botol -> pilih tujuan),
 *   - memutar animasi menuang, getaran saat langkah tidak sah,
 *   - menyimpan progres level tertinggi di localStorage (selalu try/catch).
 *
 * Aturan permainan sama sekali tidak ditulis di sini.
 */

import {
  CAPACITY,
  bottleState,
  canPour,
  cloneState,
  colorInfo,
  countDone,
  findHint,
  isWon,
  pour,
  validTargets,
} from "./logic.js";
import {
  LEVEL_COUNT,
  addEmptyBottle,
  createLevelState,
  createRandomLevel,
  getLevelConfig,
  listLevels,
} from "./levels.js";

/* -----------------------------------------------------------------------------
   Penyimpanan (selalu dibungkus try/catch)
   ----------------------------------------------------------------------------- */

const STORAGE = {
  progress: "watersort.progress.v1", // dibaca juga oleh kartu di portal
  settings: "watersort.settings.v1",
};

function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* localStorage bisa diblokir; permainan tetap jalan tanpa menyimpan progres */
  }
}

/* -----------------------------------------------------------------------------
   State aplikasi
   ----------------------------------------------------------------------------- */

/** Durasi animasi (ms). Dipendekkan kalau pemain memilih gerakan minimal. */
const TIME = { tilt: 260, pourTime: 420, settle: 180 };

const state = {
  entry: null, // { config, state, solution } dari levels.js
  current: null, // state yang sedang dimainkan { bottles, moves }
  history: [], // riwayat state (Batal tanpa batas)
  selection: null, // indeks botol terpilih
  busy: false, // true saat animasi berjalan
  extraBottleUsed: false,
  hint: null,
  accessible: false,
  progress: { highest: 1, completed: [] },
  reducedMotion: false,
};

const dom = {};
let bottleEls = [];
let hintTimer = null;

/* -----------------------------------------------------------------------------
   Utilitas kecil
   ----------------------------------------------------------------------------- */

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Membuat elemen dengan atribut & anak sekaligus. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

/**
 * Nama botol untuk pembaca layar.
 * Contoh: "Botol 2: 3 dari 4 lapis terisi, sisa 1 slot. Dari bawah ke atas: merah, biru.
 *          Bisa dituang ke sini."
 */
function bottleLabel(index, bottle, visual = {}) {
  const kepala = `Botol ${index + 1}`;
  const tujuan = visual.isTarget ? " Bisa dituang ke sini." : "";
  if (!bottle.length) return `${kepala}: kosong (${CAPACITY} slot kosong).${tujuan}`;
  const isi = bottle.map((color) => colorInfo(color).label).join(", ");
  const sisa = CAPACITY - bottle.length;
  const status = visual.state === "done" ? " Sudah selesai." : sisa === 0 ? " Penuh." : "";
  return `${kepala}: ${bottle.length} dari ${CAPACITY} lapis terisi, sisa ${sisa} slot. Dari bawah ke atas: ${isi}.${status}${tujuan}`;
}

/**
 * Keadaan visual satu botol (kelas CSS + keterangan status).
 * Aturan penuangan diambil dari logic.js (`validTargets`), tidak ditulis ulang di sini.
 *
 * @param {number} index indeks botol
 * @param {string[][]} bottles seluruh botol (untuk menghitung tujuan yang sah)
 * @param {{selection?:number|null, targets?:number[]}} [options]
 */
export function bottleVisualState(index, bottles, options = {}) {
  const selection = options.selection ?? null;
  const targets = options.targets ?? (selection === null ? [] : validTargets({ bottles }, selection));
  const bottle = bottles[index] ?? [];
  const state = bottleState(bottle);
  const kelas = [];

  if (state === "empty") kelas.push("is-empty");
  if (state === "done") kelas.push("is-done");

  const sebagaiSumber = selection === index;
  if (sebagaiSumber) kelas.push("is-selected");

  // Botol selesai tidak pernah ditawarkan sebagai tujuan.
  const isTarget = !sebagaiSumber && state !== "done" && targets.includes(index);
  if (selection !== null && !sebagaiSumber) kelas.push(isTarget ? "is-valid-target" : "is-dimmed");

  return { state, classes: kelas, isTarget, isSelected: sebagaiSumber };
}

/**
 * Membuat elemen botol: kaca berisi tepat CAPACITY slot setinggi sama,
 * dirapatkan dari dasar botol, plus indikator ruang tersisa "n/4".
 *
 * @param {number} index indeks botol
 * @param {string[]} bottle isi botol dari bawah ke atas
 * @param {{bottles?:string[][], selection?:number|null, targets?:number[], incomingSlot?:number}} [options]
 * @returns {HTMLButtonElement}
 */
export function createBottleElement(index, bottle, options = {}) {
  const bottles = options.bottles ?? [bottle];
  const selection = options.selection ?? null;
  const visual = bottleVisualState(index, bottles, options);

  const button = el("button", {
    type: "button",
    class: ["ws-bottle", ...visual.classes].join(" "),
    "data-index": String(index),
    "data-state": visual.state,
    "data-filled": String(bottle.length),
    "aria-pressed": selection === index ? "true" : "false",
    "aria-label": bottleLabel(index, bottle, visual),
  });

  const glass = el("span", { class: "ws-bottle__glass" });
  glass.style.setProperty("--ws-capacity", String(CAPACITY));

  // Baris 1 = paling atas. Cairan mengisi dari baris terbawah ke atas.
  for (let row = 1; row <= CAPACITY; row += 1) {
    const layer = CAPACITY - row; // 0 = lapisan dasar botol
    if (layer < bottle.length) {
      const info = colorInfo(bottle[layer]);
      const slot = el("span", {
        class: "ws-slot",
        "data-color": info.id,
        "data-pattern": info.pattern,
        "data-layer": String(layer),
      });
      slot.style.gridRow = String(row);
      slot.style.setProperty("--slot", info.hex);
      slot.style.background = info.hex;
      slot.append(
        el("span", { class: "ws-slot__symbol", text: info.symbol, "aria-hidden": "true" }),
      );
      if (options.incomingSlot === layer) slot.classList.add("is-pouring-in");
      glass.append(slot);
    } else {
      const gap = el("span", { class: "ws-gap", "data-empty-slot": String(layer) });
      gap.style.gridRow = String(row);
      glass.append(gap);
    }
  }

  const meter = el("span", {
    class: "ws-bottle__meter",
    text: `${bottle.length}/${CAPACITY}`,
  });
  meter.title = `Terisi ${bottle.length} dari ${CAPACITY} slot`;

  button.append(glass, meter);
  return button;
}

function setMessage(text, kind = "") {
  if (!dom.message) return;
  dom.message.textContent = text;
  dom.message.classList.toggle("is-error", kind === "error");
  dom.message.classList.toggle("is-hint", kind === "hint");
}

function clearHint() {
  if (hintTimer) {
    window.clearTimeout(hintTimer);
    hintTimer = null;
  }
  for (const element of bottleEls) {
    element.classList.remove("is-hint-source", "is-hint-target");
  }
}

/* -----------------------------------------------------------------------------
   Menggambar papan
   ----------------------------------------------------------------------------- */

/**
 * Menggambar seluruh botol sesuai state sekarang.
 * @param {{pouredIn?:{index:number,count:number}}} [options] efek animasi masuk
 */
function renderBoard(options = {}) {
  if (!dom.board) return;
  const bottles = state.current.bottles;
  const incoming = options.pouredIn ?? null;
  // Tujuan yang sah dihitung sekali di sini (aturan dari logic.js).
  const targets = state.selection === null ? [] : validTargets(state.current, state.selection);

  const fragment = document.createDocumentFragment();
  bottleEls = [];

  bottles.forEach((bottle, index) => {
    const button = createBottleElement(index, bottle, {
      bottles,
      selection: state.selection,
      targets,
      incomingSlot: incoming && incoming.index === index ? bottle.length - 1 : -1,
    });
    fragment.append(button);
    bottleEls.push(button);
  });

  dom.board.replaceChildren(fragment);
  updateStats();
}

/** Memperbarui angka langkah, level, dan jumlah botol selesai. */
function updateStats() {
  if (dom.level) {
    const config = state.entry?.config;
    dom.level.textContent = config
      ? config.id > 0
        ? `Level ${config.id}: ${config.name}`
        : config.name
      : "Level ?";
  }
  if (dom.moves) dom.moves.textContent = String(state.current?.moves ?? 0);
  if (dom.par) {
    const target = state.entry?.solution?.length ?? 0;
    dom.par.textContent = target > 0 ? String(target) : "–";
  }
  if (dom.done) {
    const total = state.current?.bottles.length ?? 0;
    dom.done.textContent = `${countDone(state.current)}/${total}`;
  }
  if (dom.undo) dom.undo.disabled = state.history.length === 0 || state.busy;
  if (dom.extraBottle) {
    dom.extraBottle.disabled = state.busy || state.extraBottleUsed;
    dom.extraBottle.title = state.extraBottleUsed
      ? "Sudah dipakai di level ini (maksimal sekali per level)"
      : "Tambah satu botol kosong (sekali per level)";
  }
  if (dom.hint) dom.hint.disabled = state.busy;
  if (dom.board) dom.board.setAttribute("aria-busy", state.busy ? "true" : "false");
}

/** Menampilkan panel menang / menyembunyikannya. */
function renderWin(show) {
  if (!dom.win) return;
  dom.win.hidden = !show;
  if (!show) return;

  const isRandom = (state.entry?.config.id ?? 1) === 0;
  if (dom.winText) {
    dom.winText.textContent = `🎉 ${
      isRandom ? "Level acak selesai" : `Level ${state.entry.config.id} selesai`
    } dalam ${state.current.moves} langkah!`;
  }
  if (dom.nextLevel) {
    dom.nextLevel.hidden = !isRandom && state.entry.config.id >= LEVEL_COUNT;
    dom.nextLevel.textContent = isRandom
      ? "🎲 Acak lagi"
      : state.entry.config.id >= LEVEL_COUNT
        ? "Selesai semua 🎉"
        : "Level berikutnya ▶";
  }
}

/** Membuat ulang tombol daftar level. */
function renderLevelList() {
  if (!dom.levels) return;
  const unlocked = Math.min(Math.max(state.progress.highest || 1, 1), LEVEL_COUNT);
  const currentId = state.entry?.config.id ?? 0;
  const fragment = document.createDocumentFragment();

  for (const level of listLevels()) {
    const done = state.progress.completed.includes(level.id);
    const locked = level.id > unlocked;
    const button = el("button", {
      type: "button",
      class: "ws-level-btn",
      "data-level": String(level.id),
      disabled: locked,
      "aria-pressed": level.id === currentId ? "true" : "false",
      title: locked ? `Level ${level.id} (belum terbuka)` : `Level ${level.id}: ${level.name}`,
      text: done ? `${level.id} ✓` : String(level.id),
    });
    if (level.id === currentId) button.classList.add("is-current");
    if (done) button.classList.add("is-done");
    button.addEventListener("click", () => loadLevel(level.id));
    fragment.append(button);
  }
  dom.levels.replaceChildren(fragment);
}

/** Menyiapkan state baru untuk dimainkan. */
function startEntry(entry) {
  state.entry = entry;
  state.current = cloneState(entry.state);
  state.history = [];
  state.selection = null;
  state.extraBottleUsed = false;
  state.hint = null;
  clearHint();
  renderBoard();
  renderWin(false);
  renderLevelList();
  if (dom.tip) dom.tip.textContent = entry.config.tip ?? "";
  if (dom.par) {
    const target = entry.solution?.length ?? 0;
    dom.par.title = target
      ? `Perkiraan jumlah langkah paling sedikit: ${target} (dari solusi yang dipakai pembuat level)`
      : "";
  }
  setMessage(
    entry.config.id > 0
      ? `Level ${entry.config.id}: ${entry.config.name}. Pilih satu botol, lalu pilih botol tujuan.`
      : `${entry.config.name}. Kocokan dibuat dari langkah terbalik, jadi pasti bisa diselesaikan.`,
  );
}

/** Memuat level bernomor. */
function loadLevel(id) {
  if (state.busy) return;
  const unlocked = Math.min(Math.max(state.progress.highest || 1, 1), LEVEL_COUNT);
  if (id < 1 || id > unlocked) {
    setMessage("Level itu masih terkunci. Selesaikan level sebelumnya dulu.", "error");
    return;
  }
  startEntry(createLevelState(id));
}

/** Memuat level acak. */
function loadRandom() {
  if (state.busy) return;
  const config = getLevelConfig(Math.min(Math.max(state.progress.highest, 1), LEVEL_COUNT));
  const entry = createRandomLevel({
    colors: config.colors,
    emptyBottles: config.emptyBottles,
    scramble: Math.max(14, config.scramble),
  });
  startEntry(entry);
  setMessage(`${entry.config.name}: kocokan baru siap dimainkan.`);
}

/* -----------------------------------------------------------------------------
   Animasi menuang
   ----------------------------------------------------------------------------- */

/** Menghitung posisi aliran cairan relatif terhadap wadah papan. */
function positionStream(fromRect, toRect, colorHex) {
  if (!dom.stream || !dom.boardWrap) return;
  const wrapRect = dom.boardWrap.getBoundingClientRect();
  const tiltX = 0.55 * (toRect.left - fromRect.left);
  const mouthX = fromRect.left + fromRect.width / 2 + tiltX - 3.5;
  const mouthY = fromRect.top - 26;
  const targetTop = toRect.top + 8;

  dom.stream.hidden = false;
  dom.stream.style.left = `${mouthX - wrapRect.left}px`;
  dom.stream.style.top = `${mouthY - wrapRect.top}px`;
  dom.stream.style.height = `${Math.max(16, targetTop - mouthY)}px`;
  dom.stream.style.setProperty("--stream", colorHex);
}

function hideStream() {
  if (!dom.stream) return;
  dom.stream.hidden = true;
}

/** Menggerakkan botol sumber ke atas botol tujuan (efek menuang). */
function tiltBottle(index, fromRect, toRect) {
  const element = bottleEls[index];
  if (!element) return;
  const dx = 0.55 * (toRect.left - fromRect.left);
  const dy = toRect.top - fromRect.top - 34;
  const degrees = dx >= 0 ? 66 : -66;
  element.style.transformOrigin = dx >= 0 ? "18% 94%" : "82% 94%";
  element.classList.add("is-lifted");
  element.style.zIndex = "5";
  element.style.transform = `translate(${dx}px, ${dy}px) rotate(${degrees}deg)`;
}

function resetBottleTransform(index) {
  const element = bottleEls[index];
  if (!element) return;
  element.classList.remove("is-lifted");
  element.style.transform = "";
  element.style.transformOrigin = "";
  element.style.zIndex = "";
}

/** Memutar animasi menuang, lalu memakai state hasilnya. */
async function animatePour(from, to, amount, color) {
  const source = bottleEls[from];
  const target = bottleEls[to];
  if (!source || !target || state.reducedMotion) {
    await wait(30);
    return;
  }

  const fromRect = source.getBoundingClientRect();
  const toRect = target.getBoundingClientRect();

  tiltBottle(from, fromRect, toRect);
  await wait(TIME.tilt);

  // Lapisan paling atas keluar lebih dulu, satu per satu (permukaan turun per slot).
  const slots = Array.from(source.querySelectorAll(".ws-slot"));
  slots.slice(0, amount).forEach((slot, urutan) => {
    slot.style.animationDelay = `${urutan * 70}ms`;
    slot.classList.add("is-pouring-out");
  });

  positionStream(fromRect, toRect, colorInfo(color).hex);
  await wait(TIME.pourTime);

  hideStream();
  resetBottleTransform(from);
  await wait(TIME.settle);
}

/** Getaran pendek saat langkah tidak sah (state tidak berubah). */
function shakeBottles(...indexes) {
  for (const index of indexes) {
    const element = bottleEls[index];
    if (!element) continue;
    element.classList.remove("is-shaking");
    // Paksa browser menghitung ulang supaya animasi bisa diputar lagi.
    void element.offsetWidth;
    element.classList.add("is-shaking");
    window.setTimeout(() => element.classList.remove("is-shaking"), 460);
  }
}

/* -----------------------------------------------------------------------------
   Aksi pemain
   ----------------------------------------------------------------------------- */

/** Menangani klik botol: memilih, membatalkan pilihan, atau menuang. */
async function onBottleClick(index) {
  if (state.busy || !state.current) return;
  clearHint();

  if (state.selection === null) {
    const bottle = state.current.bottles[index];
    // Botol kosong tidak ada gunanya dipilih sebagai sumber.
    if (bottle.length === 0) {
      shakeBottles(index);
      setMessage("Botol itu kosong, tidak ada yang bisa dituang.", "error");
      return;
    }
    // Botol yang sudah selesai (penuh, satu warna) tidak bisa dipilih lagi.
    if (bottleState(bottle) === "done") {
      shakeBottles(index);
      setMessage(`Botol ${index + 1} sudah selesai (penuh satu warna) — tidak perlu diubah.`, "hint");
      return;
    }
    state.selection = index;
    const targets = validTargets(state.current, index);
    renderBoard();
    setMessage(
      targets.length
        ? `Botol ${index + 1} dipilih. Tujuan yang sah disorot hijau; sisanya diredupkan.`
        : `Botol ${index + 1} dipilih, tapi belum ada tujuan yang sah. Coba botol lain.`,
      targets.length ? "" : "hint",
    );
    return;
  }

  const from = state.selection;
  const to = index;

  if (from === to) {
    state.selection = null;
    renderBoard();
    setMessage("Pilihan dibatalkan.");
    return;
  }

  const check = canPour(state.current, from, to);
  if (!check.ok) {
    state.selection = null;
    renderBoard();
    shakeBottles(from, to);
    setMessage(explainReject(check.reason, from, to), "error");
    return;
  }

  // Langkah sah: jalankan animasi, lalu simpan state baru.
  state.selection = null;
  state.busy = true;
  updateStats();
  renderBoard();
  setMessage(`Menuang botol ${from + 1} ke botol ${to + 1}…`);

  const before = state.current;
  const result = pour(before, from, to);

  await animatePour(from, to, check.amount, check.color);

  state.history.push(before);
  state.current = result.state;
  state.busy = false;
  renderBoard({ pouredIn: { index: to, count: check.amount } });

  if (isWon(state.current)) {
    handleWin();
  } else {
    setMessage(`Langkah ke-${state.current.moves}. Lanjutkan!`);
  }
}

/** Pesan Indonesia untuk setiap alasan penolakan. */
function explainReject(reason, from, to) {
  switch (reason) {
    case "empty-source":
      return `Botol ${from + 1} kosong, tidak ada yang bisa dituang.`;
    case "no-space":
      return `Botol ${to + 1} sudah penuh.`;
    case "color-mismatch":
      return `Warna paling atas botol ${from + 1} berbeda dengan botol ${to + 1}. Botol bergetar = langkah tidak sah.`;
    case "same-bottle":
      return "Tidak bisa menuang ke botol yang sama.";
    default:
      return "Langkah itu tidak bisa dilakukan.";
  }
}

/** Menangani level selesai: simpan progres dan tampilkan panel menang. */
function handleWin() {
  const config = state.entry.config;
  const id = config.id;

  if (id > 0) {
    if (!state.progress.completed.includes(id)) state.progress.completed.push(id);
    state.progress.highest = Math.min(Math.max(state.progress.highest, id + 1), LEVEL_COUNT);
    if (id === LEVEL_COUNT) state.progress.highest = LEVEL_COUNT;
    writeStored(STORAGE.progress, state.progress);
  }

  renderLevelList();
  renderWin(true);
  setMessage(
    `🎉 Selesai dalam ${state.current.moves} langkah!` +
      (id > 0 && id < LEVEL_COUNT ? " Level berikutnya sudah terbuka." : ""),
  );
}

/** Batal: kembali ke state sebelumnya (riwayat tanpa batas). */
function undo() {
  if (state.busy || state.history.length === 0) return;
  clearHint();
  const previous = state.history.pop();
  state.current = previous;
  state.selection = null;
  renderBoard();
  renderWin(false);
  setMessage(`Dibatalkan. Sekarang di langkah ke-${state.current.moves}.`);
}

/** Ulangi level dari keadaan awal. */
function restart() {
  if (state.busy) return;
  clearHint();
  state.current = cloneState(state.entry.state);
  state.history = [];
  state.selection = null;
  state.extraBottleUsed = false; // papan kembali ke awal, jadi jatah +1 botol ikut segar
  renderBoard();
  renderWin(false);
  setMessage("Level diulang dari awal. Jatah +1 botol kosong tersedia lagi.");
}

/** Menambah satu botol kosong (sekali per level). */
function addBottle() {
  if (state.busy || state.extraBottleUsed) return;
  clearHint();
  state.history.push(state.current);
  state.current = addEmptyBottle(state.current);
  state.extraBottleUsed = true;
  state.selection = null;
  renderBoard();
  renderWin(false);
  setMessage("Satu botol kosong ditambahkan. Sisa langkah tidak berubah.", "hint");
  if (dom.extraBottle) dom.extraBottle.disabled = true;
}

/** Menampilkan saran langkah dari solver. */
function showHint() {
  if (state.busy || !state.current) return;
  if (isWon(state.current)) {
    setMessage("Level ini sudah selesai.", "hint");
    return;
  }

  const hint = findHint(state.current);
  if (!hint) {
    setMessage(
      "Tidak ada langkah berguna dari keadaan ini. Coba tekan ↶ Batal beberapa langkah.",
      "error",
    );
    return;
  }

  clearHint();
  state.hint = hint;
  bottleEls[hint.from]?.classList.add("is-hint-source");
  bottleEls[hint.to]?.classList.add("is-hint-target");
  setMessage(
    `Saran: pindahkan botol ${hint.from + 1} ke botol ${hint.to + 1}.` +
      (hint.exact
        ? ` (bagian dari solusi terpendek: ${hint.remaining} langkah lagi)`
        : " (saran perkiraan karena level ini terlalu besar untuk dihitung penuh)"),
    "hint",
  );

  // Sorotan hilang sendiri setelah beberapa detik.
  hintTimer = window.setTimeout(() => {
    clearHint();
    setMessage("Pilih satu botol, lalu pilih botol tujuan.");
  }, 6000);
}

/** Pindah ke level berikutnya (atau kocok level acak baru). */
function nextLevel() {
  const config = state.entry?.config;
  if (!config) return;
  if (config.id === 0) {
    loadRandom();
    return;
  }
  if (config.id >= LEVEL_COUNT) {
    setMessage("Semua level sudah selesai! Coba mode 🎲 Acak untuk tantangan baru.", "hint");
    return;
  }
  loadLevel(config.id + 1);
}

/** Mengubah mode aksesibel (simbol & pola). */
function setAccessible(value) {
  state.accessible = Boolean(value);
  document.body.classList.toggle("is-accessible", state.accessible);
  writeStored(STORAGE.settings, { accessible: state.accessible });
  if (dom.accessible) dom.accessible.checked = state.accessible;
}

/* -----------------------------------------------------------------------------
   Inisialisasi
   ----------------------------------------------------------------------------- */

function cacheDom() {
  dom.board = document.getElementById("wsBoard");
  dom.boardWrap = document.getElementById("wsBoardWrap");
  dom.stream = document.getElementById("wsStream");
  dom.message = document.getElementById("wsMessage");
  dom.level = document.getElementById("wsLevel");
  dom.moves = document.getElementById("wsMoves");
  dom.par = document.getElementById("wsPar");
  dom.done = document.getElementById("wsDone");
  dom.tip = document.getElementById("wsTip");
  dom.win = document.getElementById("wsWin");
  dom.winText = document.getElementById("wsWinText");
  dom.nextLevel = document.getElementById("wsNextLevel");
  dom.winReplay = document.getElementById("wsWinReplay");
  dom.undo = document.getElementById("wsUndo");
  dom.restart = document.getElementById("wsRestart");
  dom.hint = document.getElementById("wsHint");
  dom.extraBottle = document.getElementById("wsExtraBottle");
  dom.random = document.getElementById("wsRandom");
  dom.accessible = document.getElementById("wsAccessible");
  dom.levels = document.getElementById("wsLevels");
}

function bindEvents() {
  dom.board?.addEventListener("click", (event) => {
    const button = event.target.closest(".ws-bottle");
    if (!button) return;
    void onBottleClick(Number(button.dataset.index));
  });

  dom.undo?.addEventListener("click", undo);
  dom.restart?.addEventListener("click", restart);
  dom.hint?.addEventListener("click", showHint);
  dom.extraBottle?.addEventListener("click", addBottle);
  dom.random?.addEventListener("click", loadRandom);
  dom.nextLevel?.addEventListener("click", nextLevel);
  dom.winReplay?.addEventListener("click", restart);
  dom.accessible?.addEventListener("change", (event) => setAccessible(event.target.checked));

  // Esc membatalkan pilihan botol yang sedang aktif.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selection !== null && !state.busy) {
      state.selection = null;
      renderBoard();
      setMessage("Pilihan dibatalkan.");
    }
  });

  window.addEventListener("resize", () => {
    if (dom.boardWrap) dom.stream.hidden = true;
  });
}

/** Titik masuk aplikasi. */
export function initWaterSort() {
  cacheDom();
  if (!dom.board) return; // halaman ini bukan Water Sort

  state.reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const progress = readStored(STORAGE.progress, {});
  state.progress.highest = Math.min(Math.max(Number(progress.highest) || 1, 1), LEVEL_COUNT);
  state.progress.completed = Array.isArray(progress.completed) ? progress.completed : [];

  const settings = readStored(STORAGE.settings, {});
  setAccessible(Boolean(settings.accessible));

  bindEvents();
  startEntry(createLevelState(state.progress.highest));
}

// Halaman tanpa papan Water Sort (mis. berkas uji di Node) tidak diinisialisasi.
if (typeof document === "undefined") {
  /* di Node.js: tidak ada DOM yang perlu disiapkan */
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWaterSort, { once: true });
} else {
  initWaterSort();
}

/* Ekspor untuk pengujian manual di konsol browser. */
export { state, undo, restart, showHint, addBottle, loadLevel, loadRandom, onBottleClick };
export { renderBoard };
// Dipakai berkas pengujian (tests.js) untuk memeriksa tampilan botol.
// createBottleElement & bottleVisualState sudah diekspor di atas definisinya.
