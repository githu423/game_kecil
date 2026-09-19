# Portal Game Kecil

Portal game statis berisi dua permainan yang berjalan sepenuhnya di browser:

| Game | Isi | Teknologi |
| --- | --- | --- |
| 🧪 **Water Sort** | Puzzle menyortir cairan warna ke dalam botol. 20 level bertingkat + mode acak, petunjuk dari solver, batal tanpa batas, mode aksesibel. | HTML + CSS + JavaScript (tanpa library) |
| 🐍 **Python Adventure** | Tulis kode Python asli untuk mengantar karakter melewati 15 level labirin. Kode dijalankan di Web Worker memakai Pyodide. | HTML + CSS + JS + Pyodide (CDN, dipin ke satu versi) |

Tidak ada backend, tidak ada proses build, dan tidak ada `npm install`. Semua berkas
disajikan apa adanya (static hosting), jadi bisa langsung ditaruh di GitHub Pages.

---

## 1. Menjalankan di komputer sendiri

Situs ini memakai **ES Modules** dan **Web Worker**, sehingga **tidak bisa dibuka lewat
`file://`** (browser akan memblokir impor modul dan worker karena alasan keamanan).
Gunakan server statis sederhana:

```bash
# dari dalam folder repo ini
python -m http.server 8000
```

Lalu buka <http://localhost:8000/> di browser. Alternatif lain: `npx serve .`,
ekstensi "Live Server" di VS Code, atau server statis apa pun.

> Kalau halaman dibuka dengan dobel klik (`file://…/index.html`), halaman portal masih
> tampil tetapi tombol game tidak akan bekerja: modul `js/portal.js` gagal dimuat dan
> Python Adventure tidak bisa membuat Worker.

### Butuh internet?

**Tidak wajib.** Pyodide (mesin Python) sudah disertakan di dalam repo pada folder
`vendor/pyodide/` (≈13,5 MB, rilis resmi **314.0.7**), jadi Python Adventure bisa jalan
tanpa internet — termasuk saat dibuka dari GitHub Pages.

Urutan sumber yang dicoba halaman Python Adventure:

1. `vendor/pyodide/` (salinan lokal, tanpa internet),
2. `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/` (cadangan),
3. `https://unpkg.com/pyodide@314.0.7/` (cadangan kedua).

Saat memuat, status di kanan atas menunjukkan tahapnya
(unduh → siapkan → **siap**) beserta progres unduhan (`4,2 dari 13,5 MB`). Kalau
macet/tidak ada jaringan, pemuatan berhenti otomatis setelah **45 detik** dan muncul
pesan gagal + tombol **“Coba lagi”** (membuang worker lama lalu memuat ulang), dengan
detail teknis di panel error yang bisa dibuka.

Versi Pyodide dipin di dua tempat yang harus sama: `games/python-adventure/runner.js`
(`PYODIDE_VERSION`) dan `scripts/download-pyodide.mjs`. Berkas lokal juga diperiksa
SHA-256-nya, jadi salinan di repo dipastikan identik dengan rilis resmi.

---

## 2. Cara deploy ke GitHub Pages

1. **Buat repositori** di GitHub (misalnya bernama `game-kecil`). Boleh publik atau privat
   (Pages untuk repo privat butuh akun berbayar).
2. **Push isi folder ini** ke branch `main`:

   ```bash
   git init
   git add .
   git commit -m "Portal game: Water Sort + Python Adventure"
   git branch -M main
   git remote add origin https://github.com/USERNAME/NAMA-REPO.git
   git push -u origin main
   ```

   (Kalau repo sudah ada, cukup `git add . && git commit -m "..." && git push`.)
3. Buka repo di GitHub → **Settings** → **Pages**.
4. Pada **Source** pilih **Deploy from a branch**.
5. Pilih **Branch: `main`** dan **Folder: `/ (root)`**, lalu **Save**.
6. Tunggu 1–3 menit. Alamat situs akan muncul di halaman itu:
   `https://USERNAME.github.io/NAMA-REPO/`
7. **Update berikutnya** cukup `git commit` + `git push` ke `main`. Halaman akan
   diperbarui otomatis (kalau masih terlihat versi lama, lakukan *hard refresh*:
   `Ctrl+Shift+R`).

Catatan penting:

- Semua path di dalam situs **relatif** (`./css/base.css`, `../../index.html`), jadi situs
  tetap benar walau alamatnya berada di subfolder (`username.github.io/nama-repo/`).
  Jangan mengganti path menjadi absolut (`/css/...`) karena akan rusak di GitHub Pages.
- Berkas **`.nojekyll`** sudah ada di root. Berkas ini membuat GitHub Pages melewati
  proses Jekyll, sehingga folder/berkas apa pun tetap disajikan apa adanya.
- Nama repo dan nama pengguna **tidak** perlu diubah di dalam kode.

---

## 3. Struktur berkas

```
.
├── index.html                     # halaman portal (daftar game)
├── README.md                      # berkas ini
├── .nojekyll                      # menandai GitHub Pages agar tidak memakai Jekyll
├── css/
│   ├── base.css                   # token warna, reset, tombol, tema gelap/terang
│   └── portal.css                 # gaya khusus halaman portal
├── js/
│   └── portal.js                  # daftar game + kartu + tombol tema (localStorage)
├── scripts/
│   ├── download-pyodide.mjs       # mengunduh/memeriksa berkas Pyodide ke vendor/
│   ├── cek-pemuatan-pyodide.mjs   # uji mesin pemuatan + protokol worker (tanpa browser)
│   └── cek-solusi-level.mjs       # jalankan solusi 15 level dengan Pyodide asli
├── vendor/
│   └── pyodide/                   # salinan resmi Pyodide 314.0.7 (lokal, tanpa internet)
│       ├── pyodide.mjs
│       ├── pyodide.asm.mjs
│       ├── pyodide.asm.wasm
│       ├── python_stdlib.zip
│       ├── pyodide-lock.json
│       └── README.md              # keterangan versi, lisensi, cara memperbarui
└── games/
    ├── water-sort/
    │   ├── index.html             # halaman permainan
    │   ├── style.css              # gaya botol, animasi menuang, getaran
    │   ├── main.js                # UI: klik botol, animasi, undo, petunjuk, progres
    │   ├── logic.js               # aturan penuangan + solver BFS (bebas DOM)
    │   ├── levels.js              # 20 level + generator "langkah terbalik"
    │   ├── tests.js               # pengujian aturan & generator (Node/browser)
    │   └── tests.html             # halaman untuk menjalankan tests.js di browser
    └── python-adventure/
        ├── index.html             # halaman permainan (papan + editor + output)
        ├── style.css              # gaya papan, editor, panel output/error
        ├── main.js                # UI: editor, tombol Run/Stop/Step, pemutar animasi
        ├── engine.js              # state grid, aturan gerak & serang (bebas DOM)
        ├── runner.js              # jembatan Pyodide + kode Web Worker + PyodideRunner
        ├── renderer.js            # menggambar papan & karakter ke <canvas>
        ├── levels.js              # 15 level (data) + solusi referensi
        └── tests.js               # pengujian engine, data level, & pemuat Pyodide (Node)
```

Menambah game baru cukup menambahkan **satu objek** pada array `GAMES` di `js/portal.js`;
kartu di halaman portal otomatis ikut berubah.

### Memperbarui Pyodide (opsional)

```bash
node scripts/download-pyodide.mjs --verify          # periksa salinan yang ada (ukuran + SHA-256)
node scripts/download-pyodide.mjs                   # unduh ulang dari CDN resmi
node scripts/download-pyodide.mjs --version 315.0.0-alpha.2   # versi lain
```

Setelah mengganti versi, samakan `PYODIDE_VERSION` di `games/python-adventure/runner.js`
dan ukuran berkas di `PYODIDE_FILES` (aturan: di `runner.js`).

---

## 4. Kontrol & fitur

### Umum

- Semua tulisan berbahasa Indonesia.
- Tema mengikuti pengaturan sistem (`prefers-color-scheme`) dan bisa dipaksa terang/gelap
  lewat tombol **Tema** di portal (disimpan di `localStorage`).
- Fokus keyboard selalu terlihat (`:focus-visible`), bisa dimainkan tanpa mouse.
- Animasi otomatis dikurangi kalau sistem meminta `prefers-reduced-motion`.

### Water Sort

- Setiap botol punya **4 slot tetap** dengan tinggi sama; cairan selalu rapat dari dasar
  ke atas, dan sisa ruang di atas benar-benar kosong (tidak melar).
- Di bawah setiap botol ada keterangan ruang, misalnya **2/4** (2 slot terisi dari 4).
  Garis tick halus di kaca botol menandai batas tiap slot.
- Penanda keadaan botol (tidak hanya mengandalkan warna):
  - **kosong** → garis tepi putus-putus,
  - **selesai** (penuh satu warna) → tanda ✓ + sinar hijau, dan botol itu tidak bisa
    dipilih/dijadikan tujuan lagi,
  - **terpilih** (sumber) → terangkat sedikit + garis tebal,
  - setelah sumber dipilih → **tujuan yang sah disorot** dan botol lain diredupkan
    (dihitung oleh `validTargets()` di `logic.js`, jadi aturannya tidak ditulis dua kali).
- Ketuk botol untuk memilih, ketuk botol lain untuk menuang.
- Langkah tidak sah membuat botol bergetar dan **tidak mengubah apa pun**.
- **Batal** tanpa batas, **Ulang level**, **+1 botol kosong** (sekali per level), **Petunjuk**,
  **Mode aksesibel** (menambah simbol & pola pada setiap warna), **Acak**.
- Level terbuka berurutan; level tertinggi disimpan di `localStorage` dan ditampilkan di
  kartu portal.

### Python Adventure

- Tulis kode Python di editor (tombol <kbd>Tab</kbd> menyisipkan 4 spasi,
  <kbd>Shift+Tab</kbd> mengurangi indentasi, <kbd>Enter</kbd> menyalin indentasi).
- <kbd>Ctrl</kbd>+<kbd>Enter</kbd> = **Run**, <kbd>Esc</kbd> = **Stop**.
- Fungsi yang tersedia:

  ```python
  move_up()  move_down()  move_left()  move_right()   # jalan satu petak
  move_down(2)                                          # jalan 2 petak sekaligus (1–50)
  attack(arah=None)                                     # hancurkan batu di depan
  is_blocked(arah)   can_attack(arah)   at_goal()        # sensor (tidak dihitung langkah)
  print(nilai, ...)                                      # tampil di panel Output
  bantuan()                                              # daftar fungsi
  ```

  `arah` = `"up"`, `"down"`, `"left"`, atau `"right"`.
- **Jumlah langkah opsional**: `move_down(2)` = dua petak dalam satu perintah. Setiap petak
  tetap dihitung **satu aksi** dan dianimasikan satu per satu, serta tetap terkena batas
  500 aksi. Kalau tertabrak, gerakan berhenti di langkah terakhir yang gagal (bukan error).
  Argumen yang tidak sah (`move_down(0)`, `move_down(2.5)`, `move_down("2")`, atau lebih
  dari 50) ditolak dengan pesan Indonesia + nomor baris.
- Setiap aksi mengubah state permainan dan direkam; setelah kode selesai (atau error),
  rekaman itu diputar ulang sebagai animasi langkah demi langkah dengan pengatur kecepatan
  **0.5x / 1x / 2x / 4x**, tombol **Pause** dan **Step**.
- Batas aman sekali Run: **500 aksi** dan **5 detik**. Kalau terlampaui, kode dihentikan
  dan muncul pesan "Kodemu berjalan terlalu lama, cek apakah ada loop tak terbatas."
  Tombol **Stop** juga menghentikan worker yang sedang bekerja (di-`terminate`, lalu
  worker baru dibuat saat Run berikutnya).
- Error Python ditampilkan dalam bahasa Indonesia beserta nomor baris, misalnya
  `NameError` → "Nama \"move_righ\" belum dikenal… mungkin maksudmu move_right()".
  Traceback asli bisa dibuka lewat bagian "Detail teknis".
- Kode pemain **hanya** berjalan di dalam Web Worker (Pyodide), tidak pernah dievaluasi di
  thread utama, jadi antarmuka tidak pernah macet dan permainan tidak bisa "crash".
- Status pemuatan Python terlihat jelas di kanan atas: **memuat** (dengan progres unduhan
  dan bilah persen) → **siap** (disebutkan sumbernya: lokal/CDN) → **gagal** (pesan ramah,
  kemungkinan penyebab, detail teknis yang bisa dibuka, dan tombol **Coba lagi** yang
  membuang worker lama lalu memuat ulang). Tombol **Run** nonaktif selama Python belum siap
  dengan keterangan "Python belum siap", sehingga tidak ada status yang menggantung.
- Kunjungan berikutnya lebih cepat: berkas Pyodide diunduh sekali (dari salinan lokal kalau
  ada), hasilnya dipakai ulang lewat cache HTTP bawaan browser.

Data yang disimpan di `localStorage` (semua dibungkus `try/catch`, aman kalau diblokir):

| Kunci | Isi |
| --- | --- |
| `gameportal.theme.v1` | pilihan tema portal (`auto`, `dark`, `light`) |
| `watersort.progress.v1` | `{ highest, completed }` |
| `watersort.settings.v1` | `{ accessible }` |
| `pythonadventure.progress.v1` | `{ highest, completed }` |
| `pythonadventure.settings.v1` | `{ speed }` |
| `pythonadventure.code.<id>` | kode terakhir pemain di level tersebut |

---

## 5. Cara menguji

Semua pengujian bisa dijalankan tanpa peramban:

```bash
node games/water-sort/tests.js          # 34 uji: penuangan, solver, generator, slot botol, kontrak CSS
node games/python-adventure/tests.js    # 30 uji: gerak/serang, data level, pemuat Pyodide (tanpa jaringan)
node scripts/cek-pemuatan-pyodide.mjs   # protokol worker + fallback sumber, memakai Pyodide ASLI
node scripts/cek-solusi-level.mjs       # 15 solusi referensi + move_down(2) + batas 500 aksi
```

Keempatnya keluar dengan kode `1` kalau ada yang gagal, sehingga bisa dipakai di CI.
Skrip di `scripts/` memakai salinan Pyodide di `vendor/pyodide/`, jadi tidak butuh internet.

Selain itu:

- Buka `games/water-sort/tests.html` di browser untuk melihat hasil pengujian dalam bentuk
  daftar berwarna. Di browser, pengujian **tata letak botol** ikut berjalan: tinggi keempat
  slot diukur langsung (harus sama semua dan sama dengan tinggi kaca ÷ 4) dan kontrak CSS
  diperiksa dari stylesheet yang benar-benar dimuat.
- Solusi referensi ke-15 level diuji memakai **Pyodide asli** lewat
  `scripts/cek-solusi-level.mjs` (tanpa browser, karena Pyodide juga berjalan di Node.js).

---

## 6. Batasan yang diketahui

- **`file://` tidak didukung** (lihat bagian 1). Wajib lewat server statis.
- **Pyodide disertakan di repo** (`vendor/pyodide/`, ≈13,5 MB). Ini membuat repo lebih besar
  dari sekadar kode, tetapi seluruh situs jadi bisa jalan tanpa internet. Kalau ingin
  mengecilkan repo, folder itu boleh dihapus — halaman otomatis memakai CDN.
- Pemuatan pertama (dari CDN atau dari repo lewat GitHub Pages) bisa memakan beberapa detik.
  Selama itu tombol Run nonaktif dan status menampilkan progres; kalau lebih dari 45 detik
  muncul status gagal + tombol **Coba lagi** (tidak pernah menggantung diam-diam).
- Level Water Sort 13–20 terlalu besar untuk dihitung solver secara penuh, jadi tombol
  **Petunjuk** memakai saran heuristik (tetap langkah yang sah); level 1–12 memakai solusi
  terpendek dari BFS.
- Editor Python memakai `<textarea>` + nomor baris sederhana (tanpa CodeMirror) supaya
  tetap tanpa build step dan tanpa berkas tambahan.
- `move_*(n)` berhenti di langkah yang tertabrak; jadi `move_right(3)` di lorong 1 petak
  menghasilkan dua event (satu berhasil, satu menabrak), bukan tiga event gagal.

---

## 7. Lisensi

Kode permainan di repo ini bebas dipakai, diubah, dan dibagikan untuk keperluan belajar.

Berkas di `vendor/pyodide/` adalah karya tim **Pyodide** (lisensi **MPL-2.0**,
<https://github.com/pyodide/pyodide>), disertakan apa adanya dari rilis resmi 314.0.7.
Python di dalamnya adalah CPython (PSF License).
