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

Hanya **Python Adventure** yang butuh internet, yaitu saat pertama kali memuat Pyodide
(±10 MB) dari CDN jsDelivr. Water Sort 100% offline karena semua berkasnya lokal.
Versi Pyodide dipin di `games/python-adventure/runner.js` (`PYODIDE_VERSION`), jadi
pembaruan Pyodide tidak akan mengubah perilaku game tanpa sengaja.

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
        └── tests.js               # pengujian engine & data level (Node)
```

Menambah game baru cukup menambahkan **satu objek** pada array `GAMES` di `js/portal.js`;
kartu di halaman portal otomatis ikut berubah.

---

## 4. Kontrol & fitur

### Umum

- Semua tulisan berbahasa Indonesia.
- Tema mengikuti pengaturan sistem (`prefers-color-scheme`) dan bisa dipaksa terang/gelap
  lewat tombol **Tema** di portal (disimpan di `localStorage`).
- Fokus keyboard selalu terlihat (`:focus-visible`), bisa dimainkan tanpa mouse.
- Animasi otomatis dikurangi kalau sistem meminta `prefers-reduced-motion`.

### Water Sort

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
  attack(arah=None)                                     # hancurkan batu di depan
  is_blocked(arah)   can_attack(arah)   at_goal()        # sensor (tidak dihitung langkah)
  print(nilai, ...)                                      # tampil di panel Output
  bantuan()                                              # daftar fungsi
  ```

  `arah` = `"up"`, `"down"`, `"left"`, atau `"right"`.
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

Pengujian logika berjalan tanpa peramban dan tanpa Pyodide:

```bash
node games/water-sort/tests.js        # aturan penuangan, solver, generator level
node games/python-adventure/tests.js  # aturan gerak/serang, kunci-pintu, data level
```

Keduanya keluar dengan kode `1` kalau ada pengujian yang gagal, sehingga bisa dipakai di
CI. Selain itu:

- Buka `games/water-sort/tests.html` di browser untuk melihat hasil pengujian dalam bentuk
  daftar berwarna.
- Solusi referensi ke-15 level Python Adventure diuji memakai **Pyodide asli** (di luar
  repo, seperti yang dijelaskan di `games/python-adventure/levels.js`); di dalam game,
  pengujian praktisnya adalah memuat solusi itu lalu memastikan karakter sampai tujuan.

---

## 6. Batasan yang diketahui

- **`file://` tidak didukung** (lihat bagian 1). Wajib lewat server statis.
- **Python Adventure butuh koneksi internet** saat pertama membuka halaman (memuat Pyodide
  dari CDN). Kalau gagal, muncul pesan ramah dan tombol **Muat ulang Python**.
- Pemuatan Pyodide pertama kali bisa memakan 5–20 detik tergantung kecepatan internet.
  Selama itu tombol Run menunggu dan status di header menampilkan "Memuat Python…".
- Level Water Sort 13–20 terlalu besar untuk dihitung solver secara penuh, jadi tombol
  **Petunjuk** memakai saran heuristik (tetap langkah yang sah); level 1–12 memakai solusi
  terpendek dari BFS.
- Editor Python memakai `<textarea>` + nomor baris sederhana (tanpa CodeMirror) supaya
  tetap tanpa build step dan tanpa berkas tambahan.

---

## 7. Lisensi

Bebas dipakai, diubah, dan dibagikan untuk keperluan belajar.
