/**
 * main.js — UI Python Adventure: editor kode, tombol Run/Stop/Reset/Step,
 * panel output & error, dan pemutar animasi hasil eksekusi.
 *
 * Alur eksekusi (sesuai desain):
 *   1. Run  -> worker Pyodide me-reset state level lalu menjalankan kode pemain
 *              dengan cepat; setiap aksi mengubah state di engine.js dan direkam
 *              sebagai event.
 *   2. Hasil (event + output + error) dikirim kembali ke thread utama.
 *   3. Event diputar sebagai animasi berurutan di canvas (bisa Pause/Step dan
 *      diatur kecepatannya).
 */

import { applyEventToView, createView } from "./engine.js";
import { LEVELS, LEVEL_COUNT, getLevel } from "./levels.js";
import { GridRenderer } from "./renderer.js";
import { LIMITS, PyodideRunner, TimeoutError, parsePythonError } from "./runner.js";

/* -----------------------------------------------------------------------------
   Konstanta & penyimpanan
   ----------------------------------------------------------------------------- */

const STORAGE = {
  progress: "pythonadventure.progress.v1",
  settings: "pythonadventure.settings.v1",
  code: (levelId) => `pythonadventure.code.${levelId}`,
};

/** Pilihan kecepatan animasi (sesuai slider 0.5x, 1x, 2x, 4x). */
const SPEEDS = [0.5, 1, 2, 4];

/** Durasi dasar tiap jenis aksi (milidetik pada kecepatan 1x). */
const DURATIONS = { move: 280, bump: 360, attack: 360 };

/** Membaca JSON dari localStorage tanpa melempar error. */
function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

/** Menulis JSON ke localStorage tanpa melempar error. */
function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* penyimpanan bisa diblokir; permainan tetap berjalan */
  }
}

/* -----------------------------------------------------------------------------
   State aplikasi
   ----------------------------------------------------------------------------- */

const state = {
  level: getLevel(1),
  view: null,
  runner: null,
  events: [],
  lastResult: null,
  progress: { highest: 1, completed: [] },
  settings: { speed: 1 },
  pyStage: "idle", // idle | loading | ready | error
  running: false,
  lastCodeSaved: 0,
  replay: {
    playing: false,
    paused: false,
    stepping: false,
    index: 0,
    current: null,
    progress: 0,
    lastTime: 0,
    rafId: null,
    time: 0,
    texts: [],
    finished: false,
  },
};

const dom = {};
let renderer = null;
let saveTimer = null;

/* -----------------------------------------------------------------------------
   Pesan status
   ----------------------------------------------------------------------------- */

function setStatus(text) {
  if (dom.status) dom.status.textContent = text;
}

function setBanner(text, kind = "") {
  if (!dom.banner) return;
  dom.banner.textContent = text;
  dom.banner.hidden = !text;
  dom.banner.classList.toggle("is-good", kind === "good");
  dom.banner.classList.toggle("is-error", kind === "error");
  dom.banner.classList.toggle("is-warn", kind === "warn");
}

function clearOutput() {
  if (dom.output) dom.output.textContent = "";
}

function appendOutput(text) {
  if (!dom.output) return;
  dom.output.textContent += text;
  dom.output.scrollTop = dom.output.scrollHeight;
}

function showError(friendly, technical = "", line = null) {
  if (!dom.error) return;
  dom.error.hidden = false;
  if (dom.errorFriendly) dom.errorFriendly.textContent = friendly;
  if (dom.errorLine) {
    dom.errorLine.textContent = line ? `Baris ${line}` : "";
    dom.errorLine.hidden = !line;
  }
  if (dom.errorTrace) dom.errorTrace.textContent = technical || "(tidak ada detail teknis)";
  if (line) highlightLine(line, "error");
}

function hideError() {
  if (dom.error) dom.error.hidden = true;
  highlightLine(null);
}

/* -----------------------------------------------------------------------------
   Editor: nomor baris, indentasi, penyimpanan
   ----------------------------------------------------------------------------- */

/** Membangun ulang gutter (nomor baris) sesuai isi editor. */
function updateGutter() {
  if (!dom.gutter || !dom.code) return;
  const lineCount = dom.code.value.split("\n").length;
  const existing = dom.gutter.children.length;
  if (existing === lineCount) return;
  const fragment = document.createDocumentFragment();
  for (let i = 1; i <= lineCount; i += 1) {
    const line = document.createElement("div");
    line.className = "pa-gutter__line";
    line.dataset.line = String(i);
    line.textContent = String(i);
    fragment.append(line);
  }
  dom.gutter.replaceChildren(fragment);
}

/** Menyorot satu baris di gutter ("error" merah, "current" biru). */
function highlightLine(lineNumber, kind = "current") {
  if (!dom.gutter) return;
  for (const element of dom.gutter.children) {
    element.classList.remove("is-current", "is-error");
    if (lineNumber && Number(element.dataset.line) === Number(lineNumber)) {
      element.classList.add(kind === "error" ? "is-error" : "is-current");
    }
  }
}

/** Menyimpan kode level aktif (dengan penundaan supaya tidak menulis terus-menerus). */
function scheduleSaveCode() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    writeStored(STORAGE.code(state.level.id), dom.code?.value ?? "");
  }, 400);
}

/** Menambah/mengurangi 4 spasi pada setiap baris yang terseleksi. */
function indentBlock(outdent) {
  const code = dom.code;
  const value = code.value;
  const start = code.selectionStart;
  const end = code.selectionEnd;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;

  const lines = value.slice(lineStart, lineEnd).split("\n");
  const changed = lines
    .map((line) => (outdent ? line.replace(/^ {1,4}/, "") : "    " + line))
    .join("\n");

  code.setRangeText(changed, lineStart, lineEnd, "preserve");
  code.selectionStart = lineStart;
  code.selectionEnd = lineStart + changed.length;
  updateGutter();
  scheduleSaveCode();
}

/** Menyisipkan teks pada posisi kursor (dipakai untuk indentasi). */
function insertAtCursor(text, selectionOffset = 0) {
  const code = dom.code;
  if (!code) return;
  const start = code.selectionStart;
  const end = code.selectionEnd;
  code.setRangeText(text, start, end, "end");
  code.selectionStart = code.selectionEnd = start + text.length + selectionOffset;
  updateGutter();
  scheduleSaveCode();
}

/** Menghapus sampai 4 spasi di awal baris (Shift+Tab). */
function dedentLine() {
  const code = dom.code;
  if (!code) return;
  const value = code.value;
  const lineStart = value.lastIndexOf("\n", code.selectionStart - 1) + 1;
  let remove = 0;
  while (remove < 4 && value[lineStart + remove] === " ") remove += 1;
  if (remove === 0) return;
  const caret = code.selectionStart;
  code.setRangeText("", lineStart, lineStart + remove, "preserve");
  code.selectionStart = code.selectionEnd = Math.max(lineStart, caret - remove);
  updateGutter();
  scheduleSaveCode();
}

/** Menangani tombol khusus di editor: Tab, Shift+Tab, Enter (auto-indent). */
function handleEditorKeydown(event) {
  const code = dom.code;
  if (!code) return;

  if (event.key === "Tab") {
    event.preventDefault();
    const hasSelection = code.selectionStart !== code.selectionEnd;
    if (hasSelection) indentBlock(event.shiftKey);
    else if (event.shiftKey) dedentLine();
    else insertAtCursor("    ");
    return;
  }

  if (event.key === "Enter") {
    const value = code.value;
    const lineStart = value.lastIndexOf("\n", code.selectionStart - 1) + 1;
    const currentLine = value.slice(lineStart, code.selectionStart);
    const indentMatch = /^[ \t]*/.exec(currentLine);
    const indent = indentMatch ? indentMatch[0] : "";
    const extra = currentLine.trimEnd().endsWith(":") ? "    " : "";
    event.preventDefault();
    insertAtCursor(`\n${indent}${extra}`);
  }
}

/* -----------------------------------------------------------------------------
   Level & progres
   ----------------------------------------------------------------------------- */

/** Merender tombol daftar level. */
function renderLevelList() {
  if (!dom.levelList) return;
  const unlocked = Math.min(Math.max(state.progress.highest || 1, 1), LEVEL_COUNT);
  const fragment = document.createDocumentFragment();

  for (const level of LEVELS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pa-level";
    button.dataset.level = String(level.id);
    const done = state.progress.completed.includes(level.id);
    button.classList.toggle("is-current", level.id === state.level.id);
    button.classList.toggle("is-done", done);
    button.disabled = level.id > unlocked;
    button.setAttribute("aria-pressed", String(level.id === state.level.id));
    button.textContent = done ? `${level.id} ✓` : String(level.id);
    button.title = level.id > unlocked ? `Level ${level.id} (terkunci)` : `Level ${level.id}: ${level.title}`;
    button.addEventListener("click", () => loadLevel(level.id));
    fragment.append(button);
  }
  dom.levelList.replaceChildren(fragment);
}

/** Membuat ulang state tampilan dari level aktif. */
function resetView() {
  state.view = createView(state.level);
  state.events = [];
  state.lastResult = null;
  state.replay = {
    playing: false,
    paused: false,
    stepping: false,
    index: 0,
    current: null,
    progress: 0,
    lastTime: 0,
    rafId: null,
    time: 0,
    texts: [],
    finished: false,
  };
  if (renderer) {
    renderer.setLevel(state.level);
    renderer.draw(state.view, { time: 0 });
  }
  updateControls();
  updateStepStatus();
}

/** Memuat level tertentu. */
function loadLevel(id) {
  const unlocked = Math.min(Math.max(state.progress.highest || 1, 1), LEVEL_COUNT);
  if (id < 1 || id > unlocked) {
    setBanner("Level itu masih terkunci. Selesaikan level sebelumnya dulu.", "warn");
    return;
  }
  state.level = getLevel(id);
  const savedCode = readStored(STORAGE.code(id), null);
  if (dom.code) {
    dom.code.value = typeof savedCode === "string" ? savedCode : state.level.starter ?? "";
  }

  if (dom.levelTitle) dom.levelTitle.textContent = `Level ${state.level.id}: ${state.level.title}`;
  if (dom.levelInstruction) dom.levelInstruction.textContent = state.level.instruction;
  if (dom.levelHint) dom.levelHint.textContent = state.level.hint;
  if (dom.levelMeta) {
    const parts = [`Topik: ${state.level.topic}`];
    if (state.level.maxActions) parts.push(`tantangan ≤ ${state.level.maxActions} aksi`);
    dom.levelMeta.textContent = parts.join(" • ");
  }

  if (dom.nextLevel) dom.nextLevel.hidden = true;

  if (dom.canvas) {
    dom.canvas.setAttribute(
      "aria-label",
      `Papan level ${state.level.id}: ${state.level.title}. ${state.level.instruction}`,
    );
  }

  hideError();
  setBanner("");
  setStatus(state.pyStage === "ready" ? "Python siap" : "Memuat Python…");
  clearOutput();
  updateGutter();
  renderLevelList();
  resetView();
  dom.codeBox?.focus?.();
}

/* -----------------------------------------------------------------------------
   Judul langkah & kontrol animasi
   ----------------------------------------------------------------------------- */

/** Deskripsi singkat satu event untuk status. */
function describeEvent(event) {
  if (event.type === "move") {
    if (!event.ok) {
      const alasan = { wall: "terhalang", rock: "terhalang batu", door: "pintu terkunci", edge: "batas papan" };
      return `move_${event.dir}() → ${alasan[event.blockedBy] ?? "gagal"}`;
    }
    return `move_${event.dir}() → jalan`;
  }
  const hasil = {
    destroyed: "batu hancur",
    wall: "tidak mempan",
    door: "pintu tidak bisa dihancurkan",
    empty: "tidak kena apa pun",
    outside: "di luar papan",
  };
  return `attack(${event.dir}) → ${hasil[event.result] ?? event.result}`;
}

function updateStepStatus() {
  if (!dom.stepStatus) return;
  const total = state.events.length;
  if (!total) {
    dom.stepStatus.textContent = "Belum ada langkah. Tekan Run untuk menjalankan kodemu.";
    return;
  }
  const done = state.replay.index;
  const current = state.replay.current;
  const info = current ? describeEvent(current) : state.replay.finished ? "selesai" : "siap";
  dom.stepStatus.textContent = `Langkah ${Math.min(done + (current ? 1 : 0), total)}/${total} — ${info}`;
}

function updateControls() {
  const ready = state.pyStage === "ready";
  if (dom.run) {
    // Run baru aktif setelah Python benar-benar siap.
    dom.run.disabled = state.running || !ready;
    dom.run.title = ready
      ? "Jalankan kodemu (Ctrl+Enter)"
      : "Python belum siap — tunggu status “Python siap” di kanan atas.";
  }
  if (dom.runHint) dom.runHint.textContent = ready ? "Ctrl+Enter" : "Python belum siap";
  if (dom.stop) dom.stop.disabled = !state.running && !state.replay.playing;
  if (dom.pause) {
    dom.pause.disabled = !state.replay.playing;
    dom.pause.textContent = state.replay.paused ? "▶ Lanjut" : "⏸ Pause";
  }
  if (dom.step) dom.step.disabled = !state.replay.playing;
  if (dom.retryPy) dom.retryPy.hidden = state.pyStage !== "error";
  if (dom.pyDot) dom.pyDot.dataset.stage = state.pyStage;
  if (dom.speedLabel) dom.speedLabel.textContent = `${SPEEDS[state.settings.speed]}x`;
  if (dom.challenge) {
    const max = state.level.maxActions;
    const maxLines = state.level.maxLines;
    const bagian = [];
    if (max) bagian.push(`maksimal ${max} aksi`);
    if (maxLines) bagian.push(`maksimal ${maxLines} baris kode`);
    dom.challenge.textContent = bagian.length ? `Tantangan efisiensi: ${bagian.join(" • ")}` : "";
    dom.challenge.hidden = bagian.length === 0;
  }
}

/* -----------------------------------------------------------------------------
   Runner Pyodide
   ----------------------------------------------------------------------------- */

/** Menampilkan/menyembunyikan bilah progres unduhan Python. */
function setPyProgress(progress) {
  if (!dom.pyProgress) return;
  if (!progress) {
    dom.pyProgress.hidden = true;
    dom.pyProgress.value = 0;
    return;
  }
  const persen = Math.max(0, Math.min(100, Math.round(progress.percent ?? 0)));
  dom.pyProgress.hidden = false;
  dom.pyProgress.value = persen;
  dom.pyProgress.textContent = `${persen}%`;
}

/**
 * Menangani kabar status dari worker Pyodide.
 * Tiga keadaan: memuat (dengan progres) → siap → gagal (dengan tombol Coba lagi).
 */
function handlePyStatus({ stage, message, progress, sourceLabel, technical }) {
  if (stage === "ready") {
    state.pyStage = "ready";
    setPyProgress(null);
    setStatus(`Python siap 🐍 (${sourceLabel ?? "sumber tidak diketahui"})`);
    // Hapus hanya banner error lama supaya pesan kemenangan tidak ikut hilang.
    if (dom.banner?.classList.contains("is-error")) setBanner("");
  } else if (stage === "error") {
    state.pyStage = "error";
    setPyProgress(null);
    setStatus("Python gagal dimuat");
    const pesanRamah =
      "Python (Pyodide) tidak bisa dimuat. Penyebab yang mungkin: tidak ada koneksi internet, " +
      "jaringan lambat, atau berkas CDN diblokir (pemblokir iklan/firewall). Klik “Coba lagi”.";
    setBanner("Python gagal dimuat. Klik “Coba lagi” di atas editor.", "error");
    showError(pesanRamah, technical || message);
    // Bantu diagnosis dari konsol browser.
    console.error("[Python Adventure] Gagal memuat Pyodide:", technical || message);
  } else {
    state.pyStage = "loading";
    setPyProgress(progress ?? null);
    setStatus(message ? `🐍 ${message}` : "Menyiapkan Python…");
  }
  updateControls();
}

/** Menyiapkan PyodideRunner (sekali) dan mulai memuat Pyodide. */
function ensureRunner() {
  if (state.runner) {
    // Worker bisa saja sudah dibuang (setelah Stop / batas waktu): muat ulang.
    if (state.pyStage !== "ready" && state.pyStage !== "loading") {
      state.pyStage = "loading";
      updateControls();
      state.runner.ensureReady().catch(() => {
        /* kegagalan sudah ditampilkan lewat onStatus */
      });
    }
    return state.runner;
  }

  state.runner = new PyodideRunner({
    onStatus: handlePyStatus,
    onStdout: (text) => appendOutput(text),
  });

  state.runner.ensureReady().catch(() => {
    /* kegagalan sudah ditampilkan lewat onStatus */
  });
  return state.runner;
}

/** Tombol "Coba lagi": buang worker lama, lalu muat Python dari awal. */
function onRetryPython() {
  hideError();
  setBanner("");
  state.pyStage = "loading";
  setStatus("Memuat ulang Python…");
  updateControls();
  const runner = state.runner ?? ensureRunner();
  runner.retry().catch(() => {
    /* kegagalan sudah ditampilkan lewat onStatus */
  });
}

/** Memuat ulang Python di latar belakang (setelah Stop atau batas waktu). */
function reloadPythonInBackground() {
  if (!state.runner) return;
  state.pyStage = "loading";
  setStatus("Menyiapkan Python lagi…");
  updateControls();
  state.runner.ensureReady().catch(() => {
    /* kegagalan sudah ditampilkan lewat onStatus */
  });
}

/* -----------------------------------------------------------------------------
   Menjalankan kode
   ----------------------------------------------------------------------------- */

async function onRun() {
  if (state.running) return;
  if (state.pyStage !== "ready") {
    setBanner(
      state.pyStage === "error"
        ? "Python belum bisa dipakai. Klik “Coba lagi” di atas editor."
        : "Python belum siap, tunggu sebentar lalu tekan Run lagi.",
      "warn",
    );
    return;
  }
  const code = dom.code?.value ?? "";
  if (!code.trim()) {
    setBanner("Tulis kode Python dulu, lalu tekan Run.", "warn");
    dom.code?.focus();
    return;
  }

  hideError();
  clearOutput();
  setBanner("");
  writeStored(STORAGE.code(state.level.id), code);
  resetView(); // state level kembali ke awal sebelum kode dijalankan

  state.running = true;
  updateControls();
  setStatus(state.pyStage === "ready" ? "Menjalankan kodemu…" : "Memuat Python…");

  const runner = ensureRunner();

  try {
    const result = await runner.run(code, state.level);
    state.lastResult = result;
    applyResult(result);
  } catch (error) {
    handleRunFailure(error);
  } finally {
    state.running = false;
    updateControls();
  }
}

/** Menampilkan hasil eksekusi lalu memutar animasinya. */
function applyResult(result) {
  if (result.output) appendOutput(result.output);
  if (result.truncated) appendOutput("… (output dipotong karena terlalu panjang)\n");

  if (result.error) {
    if (result.error.kind === "action-limit") {
      const pesan = `Kodemu melakukan lebih dari ${LIMITS.maxActions} aksi. Coba pakai perulangan atau rute yang lebih pendek.`;
      showError(pesan, result.error.message);
      setBanner(pesan, "error");
    } else if (result.error.kind === "pyodide") {
      showError(
        "Python gagal dimuat. Periksa koneksi internet, lalu klik “Muat ulang Python” dan coba lagi.",
        result.error.message,
      );
      setBanner("Python gagal dimuat.", "error");
    } else {
      const parsed = parsePythonError(result.error.message);
      showError(parsed.friendly, parsed.technical, parsed.line);
      setBanner("Kode berhenti karena error. Cek pesan di bawah editor.", "error");
    }
  } else {
    hideError();
  }

  startReplay(result);
}

/**
 * Menghitung baris kode yang berisi perintah (baris kosong dan komentar diabaikan).
 * Dipakai untuk tantangan efisiensi "maksimal N baris".
 */
function countCodeLines(code) {
  return String(code ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")).length;
}

/** Karakter pernah menyentuh tile tujuan selama kode berjalan? */
function didReachGoal(result) {
  if (result.reachedGoal) return true;
  return Array.isArray(result.events) && result.events.some((event) => event.reachedGoal);
}

/** Menangani kegagalan di thread utama (mis. batas waktu). */
function handleRunFailure(error) {
  if (error instanceof TimeoutError) {
    const pesan =
      "Kodemu berjalan terlalu lama, cek apakah ada loop tak terbatas. " +
      "(Python perlu dimuat ulang, tunggu sebentar saat menjalankan lagi.)";
    showError(pesan, "Batas waktu 5 detik terlampaui; worker dihentikan paksa.");
    setBanner("Kodemu berjalan terlalu lama, cek apakah ada loop tak terbatas.", "error");
    // Worker sudah dibuang saat timeout: siapkan Python lagi di latar belakang.
    reloadPythonInBackground();
    return;
  }
  const pesan = String(error?.message ?? error);
  if (pesan.includes("Dihentikan")) {
    setStatus("Kode dihentikan.");
    setBanner("Kode dihentikan. Tekan Run untuk mencoba lagi.", "warn");
    return;
  }
  showError("Terjadi masalah saat menjalankan kode. Coba lagi.", pesan);
  setBanner("Terjadi masalah teknis saat menjalankan kode.", "error");
}

/* -----------------------------------------------------------------------------
   Pemutar animasi
   ----------------------------------------------------------------------------- */

function durationFor(event) {
  const base = event.type === "attack" ? DURATIONS.attack : event.ok ? DURATIONS.move : DURATIONS.bump;
  // Kalau langkahnya sangat banyak (mis. kode kena batas aksi), percepat supaya
  // pemutaran tidak terasa lama; pilihan kecepatan pemain tetap dikalikan di atasnya.
  const total = state.events.length;
  const crowd = total > 120 ? 0.25 : total > 40 ? 0.5 : 1;
  return Math.max(60, base * crowd);
}

/** Memutar daftar event hasil eksekusi. */
function startReplay(result) {
  state.events = Array.isArray(result.events) ? result.events : [];
  state.replay.index = 0;
  state.replay.current = null;
  state.replay.progress = 0;
  state.replay.texts = [];
  state.replay.finished = false;
  state.replay.playing = state.events.length > 0;
  state.replay.paused = false;
  state.replay.stepping = false;
  state.replay.lastTime = 0;

  if (!state.events.length) {
    setStatus("Kode selesai tanpa aksi.");
    updateStepStatus();
    finishReplay();
    return;
  }

  setStatus(`Memutar ${state.events.length} langkah…`);
  updateControls();
  updateStepStatus();
  if (state.replay.rafId) cancelAnimationFrame(state.replay.rafId);
  state.replay.rafId = requestAnimationFrame(frame);
}

/** Loop animasi utama. */
function frame(now) {
  const replay = state.replay;
  if (!replay.playing) return;

  replay.time += 16;
  const dt = replay.lastTime ? Math.min(now - replay.lastTime, 120) : 16;
  replay.lastTime = now;

  if (!replay.paused) {
    advance(dt * SPEEDS[state.settings.speed]);
  } else if (replay.stepping) {
    // Step: maju satu event saja, lalu berhenti lagi.
    advance(40);
  }

  // Efek teks melayang (umur dipercepat bersama animasi)
  for (const text of replay.texts) text.t += (dt / 900) * SPEEDS[state.settings.speed];
  replay.texts = replay.texts.filter((text) => text.t < 1);

  drawScene();
  updateStepStatus();

  if (replay.playing) {
    replay.rafId = requestAnimationFrame(frame);
  }
}

/** Memajukan animasi sebanyak `dt` milidetik. */
function advance(dt) {
  const replay = state.replay;

  if (!replay.current) {
    if (replay.index >= state.events.length) {
      finishReplay();
      return;
    }
    replay.current = state.events[replay.index];
    replay.progress = 0;
  }

  replay.progress += dt / durationFor(replay.current);

  if (replay.progress >= 1) {
    const event = replay.current;
    applyEventToView(state.view, event);
    replay.index += 1;
    replay.current = null;
    replay.progress = 0;
    highlightLine(event.line);
    spawnEffectTexts(event);

    if (replay.stepping) {
      replay.stepping = false;
      replay.paused = true;
      updateControls();
    }

    if (replay.index >= state.events.length) finishReplay();
  }
}

/** Menambahkan teks melayang untuk efek aksi. */
function spawnEffectTexts(event) {
  const replay = state.replay;
  if (event.type === "move") {
    if (!event.ok) {
      replay.texts.push({ text: "menabrak", row: event.row, col: event.col, t: 0, color: "#dc2626" });
    } else if (event.collected?.type === "key") {
      replay.texts.push({ text: "kunci +1", row: event.row, col: event.col, t: 0, color: "#f59e0b" });
    } else if (event.collected?.type === "coin") {
      replay.texts.push({ text: "koin +1", row: event.row, col: event.col, t: 0, color: "#eab308" });
    } else if (event.opened) {
      replay.texts.push({ text: "pintu terbuka", row: event.row, col: event.col, t: 0, color: "#16a34a" });
    }
    return;
  }

  if (event.type === "attack") {
    const target = event.target ?? { row: event.row, col: event.col };
    if (event.result === "destroyed") {
      replay.texts.push({ text: "hancur!", row: target.row, col: target.col, t: 0, color: "#0f172a" });
    } else if (event.result === "wall") {
      replay.texts.push({ text: "tidak mempan", row: target.row, col: target.col, t: 0, color: "#dc2626" });
    } else if (event.result === "door") {
      replay.texts.push({ text: "butuh kunci", row: target.row, col: target.col, t: 0, color: "#b45309" });
    }
  }
}

/** Animasi yang sedang berjalan, dipakai renderer. */
function currentAnim() {
  const replay = state.replay;
  const event = replay.current;
  if (!event) return null;
  const t = Math.min(1, Math.max(0, replay.progress));

  if (event.type === "move") {
    return event.ok
      ? { type: "move", to: { row: event.row, col: event.col }, t, facing: event.facing }
      : { type: "bump", dir: event.dir, t, facing: event.facing };
  }
  if (event.type === "attack") {
    return { type: "attack", target: event.target, dir: event.dir, result: event.result, t, facing: event.facing };
  }
  return null;
}

/** Menggambar papan. */
function drawScene() {
  if (!renderer || !state.view) return;
  renderer.draw(state.view, {
    anim: currentAnim(),
    texts: state.replay.texts,
    time: state.replay.time,
  });
}

/** Dipanggil setelah seluruh event selesai diputar. */
function finishReplay() {
  const replay = state.replay;
  replay.playing = false;
  replay.paused = false;
  replay.stepping = false;
  replay.finished = true;
  if (replay.rafId) cancelAnimationFrame(replay.rafId);
  replay.rafId = null;
  drawScene();
  updateControls();
  updateStepStatus();

  const result = state.lastResult;
  if (!result) return;

  if (didReachGoal(result)) {
    handleWin(result);
  } else if (!result.error) {
    setBanner("Belum sampai tujuan, coba lagi.", "warn");
    setStatus("Animasi selesai — karakter belum di tujuan.");
  }
}

/** Menampilkan daftar fungsi bawaan di panel Output. */
function onShowHelp() {
  appendOutput(
    [
      "Fungsi yang bisa dipakai:",
      "  move_up()  move_down()  move_left()  move_right()   -> jalan satu tile",
      "  move_down(2)   move_right(3)   ...                   -> jalan beberapa tile sekaligus",
      "     (angka 1 sampai 50; berhenti sendiri kalau tertabrak; tiap tile = 1 aksi)",
      "  attack(arah=None)                                    -> serang tile di arah hadap terakhir",
      "  is_blocked(arah)   can_attack(arah)   at_goal()      -> sensor (tidak dihitung langkah)",
      "  print(nilai, ...)                                    -> tampil di panel Output",
      "",
      `Batas sekali Run: ${LIMITS.maxActions} aksi dan 5 detik. Arah: 'up', 'down', 'left', 'right'.`,
      "Tile: # tembok | R batu (bisa dihancurkan) | G tujuan | K kunci | D pintu | C koin",
      "",
    ].join("\n"),
  );
  setStatus("Daftar fungsi ditampilkan di panel Output.");
}

/** Karakter berhasil sampai tujuan. */
function handleWin(result) {
  const id = state.level.id;
  if (!state.progress.completed.includes(id)) state.progress.completed.push(id);
  const unlocked = Math.min(id + 1, LEVEL_COUNT);
  if (unlocked > state.progress.highest) state.progress.highest = unlocked;
  writeStored(STORAGE.progress, state.progress);
  renderLevelList();

  let pesan = `🎉 Karakter sampai di tujuan dengan ${result.actionCount} aksi!`;
  if (state.level.maxActions) {
    pesan +=
      result.actionCount <= state.level.maxActions
        ? ` Tantangan aksi tercapai (≤ ${state.level.maxActions}).`
        : ` Tantangan aksi belum tercapai (maksimal ${state.level.maxActions}).`;
  }
  if (state.level.maxLines) {
    const lines = countCodeLines(dom.code?.value ?? "");
    pesan +=
      lines <= state.level.maxLines
        ? ` Kode ringkas: ${lines} baris (≤ ${state.level.maxLines}).`
        : ` Kode masih ${lines} baris (tantangan ≤ ${state.level.maxLines}).`;
  }
  setBanner(pesan, "good");
  setStatus("Selesai! Coba level berikutnya.");

  if (state.level.id < LEVEL_COUNT) {
    if (dom.nextLevel) {
      dom.nextLevel.hidden = false;
      dom.nextLevel.textContent = `Level ${state.level.id + 1} ▶`;
    }
  } else if (dom.nextLevel) {
    dom.nextLevel.hidden = true;
  }
}

/* -----------------------------------------------------------------------------
   Aksi tombol
   ----------------------------------------------------------------------------- */

function onStop() {
  if (state.runner) state.runner.stop();
  state.running = false;
  stopReplay();
  setBanner("Kode dihentikan. Python disiapkan lagi, sebentar…", "warn");
  reloadPythonInBackground();
}

/** Menghentikan animasi yang sedang berjalan. */
function stopReplay() {
  const replay = state.replay;
  replay.playing = false;
  replay.paused = false;
  replay.stepping = false;
  if (replay.rafId) cancelAnimationFrame(replay.rafId);
  replay.rafId = null;
}

function onPauseToggle() {
  const replay = state.replay;
  if (!replay.playing) return;
  replay.paused = !replay.paused;
  replay.stepping = false;
  replay.lastTime = 0;
  setStatus(replay.paused ? "Animasi dijeda." : "Memutar animasi…");
  updateControls();
}

function onStep() {
  const replay = state.replay;
  if (!replay.playing) {
    setBanner("Tekan Run dulu, baru bisa memakai Step.", "warn");
    return;
  }
  replay.paused = true;
  replay.stepping = true;
  updateControls();
}

function onReset() {
  onStop();
  resetView();
  clearOutput();
  hideError();
  setBanner("");
  setStatus(state.pyStage === "ready" ? "Python siap" : "Memuat Python…");
}

function onRestoreStarter() {
  if (!dom.code) return;
  dom.code.value = state.level.starter ?? "";
  updateGutter();
  scheduleSaveCode();
  setBanner("Kode awal level ini dipasang kembali.", "warn");
}

function onSpeedChange() {
  if (!dom.speed) return;
  const index = Number(dom.speed.value) || 0;
  state.settings.speed = Math.min(Math.max(index, 0), SPEEDS.length - 1);
  writeStored(STORAGE.settings, state.settings);
  updateControls();
}

/* -----------------------------------------------------------------------------
   Inisialisasi
   ----------------------------------------------------------------------------- */

function cacheDom() {
  dom.canvas = document.getElementById("paCanvas");
  dom.code = document.getElementById("paCode");
  dom.gutter = document.getElementById("paGutter");
  dom.codeBox = document.getElementById("paEditor");
  dom.output = document.getElementById("paOutput");
  dom.status = document.getElementById("paStatus");
  dom.banner = document.getElementById("paBanner");
  dom.stepStatus = document.getElementById("paStepStatus");
  dom.error = document.getElementById("paError");
  dom.errorFriendly = document.getElementById("paErrorFriendly");
  dom.errorLine = document.getElementById("paErrorLine");
  dom.errorTrace = document.getElementById("paErrorTrace");
  dom.run = document.getElementById("paRun");
  dom.stop = document.getElementById("paStop");
  dom.reset = document.getElementById("paReset");
  dom.pause = document.getElementById("paPause");
  dom.step = document.getElementById("paStep");
  dom.speed = document.getElementById("paSpeed");
  dom.speedLabel = document.getElementById("paSpeedLabel");
  dom.levelList = document.getElementById("paLevels");
  dom.levelTitle = document.getElementById("paLevelTitle");
  dom.levelInstruction = document.getElementById("paLevelInstruction");
  dom.levelHint = document.getElementById("paLevelHint");
  dom.levelMeta = document.getElementById("paLevelMeta");
  dom.challenge = document.getElementById("paChallenge");
  dom.runHint = document.getElementById("paRunHint");
  dom.pyDot = document.getElementById("paPyDot");
  dom.pyProgress = document.getElementById("paPyProgress");
  dom.retryPy = document.getElementById("paRetryPy");
  dom.nextLevel = document.getElementById("paNextLevel");
  dom.restoreStarter = document.getElementById("paRestoreStarter");
  dom.help = document.getElementById("paHelp");
}

function bindEvents() {
  dom.run?.addEventListener("click", () => void onRun());
  dom.stop?.addEventListener("click", onStop);
  dom.reset?.addEventListener("click", onReset);
  dom.pause?.addEventListener("click", onPauseToggle);
  dom.step?.addEventListener("click", onStep);
  dom.speed?.addEventListener("input", onSpeedChange);
  dom.restoreStarter?.addEventListener("click", onRestoreStarter);
  dom.nextLevel?.addEventListener("click", () => loadLevel(state.level.id + 1));
  dom.help?.addEventListener("click", onShowHelp);
  dom.retryPy?.addEventListener("click", onRetryPython);

  dom.code?.addEventListener("input", () => {
    updateGutter();
    scheduleSaveCode();
  });
  dom.code?.addEventListener("keydown", handleEditorKeydown);
  dom.code?.addEventListener("scroll", () => {
    if (dom.gutter) dom.gutter.scrollTop = dom.code.scrollTop;
  });

  // Pintasan keyboard: Ctrl/Cmd+Enter = Run, Esc = Stop.
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void onRun();
    } else if (event.key === "Escape") {
      onStop();
    }
  });

  window.addEventListener("resize", () => {
    if (!renderer) return;
    renderer.resize();
    drawScene();
  });

  window.addEventListener("beforeunload", () => {
    state.runner?.dispose();
  });
}

/** Titik masuk aplikasi. */
export function initPythonAdventure() {
  cacheDom();
  if (!dom.canvas || !dom.code) return; // halaman bukan Python Adventure

  renderer = new GridRenderer(dom.canvas);

  const settings = readStored(STORAGE.settings, {});
  state.settings.speed = Math.min(Math.max(Number(settings.speed) || 1, 0), SPEEDS.length - 1);
  const progress = readStored(STORAGE.progress, {});
  state.progress.highest = Math.min(Math.max(Number(progress.highest) || 1, 1), LEVEL_COUNT);
  state.progress.completed = Array.isArray(progress.completed) ? progress.completed : [];

  if (dom.speed) dom.speed.value = String(state.settings.speed);

  bindEvents();
  loadLevel(state.progress.highest);
  ensureRunner(); // Pyodide dimuat di latar belakang supaya siap saat pemain menekan Run
  updateControls();

  // Setelah layout selesai, ukuran canvas dihitung ulang supaya grid pas.
  window.setTimeout(() => {
    renderer.resize();
    drawScene();
  }, 0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPythonAdventure, { once: true });
} else {
  initPythonAdventure();
}

/* Ekspor untuk pengujian manual di konsol browser. */
export { state, loadLevel, onRun, applyResult, advance, finishReplay, startReplay, resetView };
