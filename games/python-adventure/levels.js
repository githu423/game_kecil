/**
 * levels.js — data 15 level Python Adventure (array/JSON, bukan hardcode di logika).
 *
 * Simbol tile:
 *   #  tembok (tidak bisa dilewati & tidak bisa dihancurkan)
 *   .  lantai
 *   R  batu/rintangan (bisa dihancurkan dengan attack())
 *   S  start
 *   G  tujuan
 *   K  kunci (untuk membuka pintu D)
 *   D  pintu
 *   C  koin (bonus, opsional)
 *
 * Setiap level punya `solution` (solusi referensi) yang TIDAK ditampilkan ke pemain,
 * tapi dipakai oleh tests.html untuk memastikan setiap level benar-benar bisa selesai.
 *
 * Kurva belajar:
 *   level 1–3   : hanya move_*
 *   level 4–6   : attack() untuk membuka jalan
 *   level 7–9   : for dan range()
 *   level 10–12 : while dan sensor is_blocked()/can_attack()
 *   level 13–15 : if/else, fungsi buatan sendiri (def), dan gabungan semuanya
 */

export const LEVELS = [
  {
    id: 1,
    title: "Langkah Pertama",
    topic: "move",
    instruction:
      "Gunakan move_down() dan move_right() untuk membawa karakter (lingkaran biru) ke bendera tujuan.",
    hint:
      "Tulis satu perintah per baris, contoh: move_down() lalu tekan Run. " +
      "Bisa juga digabung: move_down(2) artinya turun dua tile sekaligus.",
    starter: "move_down()\n",
    grid: ["#####", "#S..#", "#.#.#", "#..G#", "#####"],
    maxActions: 6,
    maxLines: 6,
    solution: `move_down()
move_down()
move_right()
move_right()
`,
  },
  {
    id: 2,
    title: "Belok",
    topic: "move",
    instruction: "Jalur ini butuh berbelok. Pakai tiga kali move_down() lalu dua kali move_right().",
    hint:
      "Kamu boleh memanggil perintah yang sama berkali-kali, atau memakai angka: " +
      "move_down(3) untuk tiga tile sekaligus.",
    starter: "move_down()\nmove_down()\n",
    grid: ["#####", "#S..#", "#.#.#", "#.#.#", "#..G#", "#####"],
    maxActions: 8,
    maxLines: 8,
    solution: `move_down()
move_down()
move_down()
move_right()
move_right()
`,
  },
  {
    id: 3,
    title: "Jalan Memutar",
    topic: "move",
    instruction:
      "Rute lebih panjang: maju ke kanan, turun di ujung lorong, lalu kembali ke kiri dan turun ke bendera.",
    hint: "Hitung dulu berapa langkah untuk tiap bagian, baru tulis kodenya.",
    starter: "",
    grid: [
      "#######",
      "#S....#",
      "#.###.#",
      "#.....#",
      "#.###.#",
      "#G....#",
      "#######",
    ],
    maxActions: 14,
    maxLines: 12,
    solution: `move_right()
move_right()
move_right()
move_right()
move_down()
move_down()
move_left()
move_left()
move_left()
move_left()
move_down()
move_down()
`,
  },
  {
    id: 4,
    title: "Batu Pertama",
    topic: "attack",
    instruction:
      "Ada batu (R) menghalangi jalan. Batu bisa dihancurkan dengan attack(). Karakter menghadap ke kanan.",
    hint: "attack() menghancurkan tile di depan arah hadap. Setelah batu hilang, jalan bisa dilewati.",
    starter: "attack()\n",
    grid: ["#######", "#SR..G#", "#######"],
    facing: "right",
    maxActions: 6,
    maxLines: 8,
    solution: `attack()
move_right()
move_right()
move_right()
move_right()
`,
  },
  {
    id: 5,
    title: "Arah Hadap",
    topic: "attack",
    instruction:
      "Batu ada di bawah karakter. Coba move_down() dulu: karakter akan berpaling ke bawah, lalu attack() akan mengenai batu itu.",
    hint: "Setiap kali memanggil move_*, arah hadap karakter berubah — termasuk saat gerakannya terhalang.",
    starter: "move_down()\nmove_down()\n",
    grid: ["#####", "#S..#", "#.#.#", "#R#.#", "#G#.#", "#####"],
    maxActions: 6,
    maxLines: 8,
    solution: `move_down()
move_down()
attack()
move_down()
move_down()
`,
  },
  {
    id: 6,
    title: "Dua Batu",
    topic: "attack",
    instruction: "Ada dua batu di lorong bawah. Hancurkan keduanya untuk sampai ke bendera.",
    hint: "Kamu bisa menyerang berkali-kali: panggil attack() setiap kali jalan terhalang.",
    starter: "",
    grid: [
      "#####",
      "#S..#",
      "#.#.#",
      "#.#.#",
      "#R#.#",
      "#.#.#",
      "#R#.#",
      "#G#.#",
      "#####",
    ],
    maxActions: 12,
    maxLines: 14,
    solution: `move_down()
move_down()
move_down()
attack()
move_down()
move_down()
move_down()
attack()
move_down()
move_down()
`,
  },
  {
    id: 7,
    title: "Perulangan Pertama",
    topic: "for",
    instruction:
      "Tulis perulangan for dengan range() supaya tidak perlu menulis move_right() tujuh kali.",
    hint: "for i in range(7): lalu baris berikutnya diberi indentasi 4 spasi berisi move_right().",
    starter: "for i in range(7):\n    move_right()\n",
    grid: ["##########", "#S......G#", "##########"],
    maxActions: 8,
    maxLines: 4,
    solution: `for i in range(7):
    move_right()
`,
  },
  {
    id: 8,
    title: "Tangga",
    topic: "for",
    instruction:
      "Pakai satu perulangan yang isinya DUA perintah: move_right() lalu move_down().",
    hint: "for i in range(3): lalu di dalamnya tulis kedua perintah dengan indentasi yang sama.",
    starter: "for i in range(3):\n    move_right()\n",
    grid: ["######", "#S...#", "#....#", "#....#", "#...G#", "######"],
    maxActions: 8,
    maxLines: 6,
    solution: `for i in range(3):
    move_right()
    move_down()
`,
  },
  {
    id: 9,
    title: "Dua Perulangan",
    topic: "for",
    instruction:
      "Butuh dua perulangan: satu untuk jalan ke kanan, satu untuk turun. Angka di range() boleh berbeda.",
    hint: "Perulangan pertama range(5) untuk ke kanan, perulangan kedua range(3) untuk turun.",
    starter: "for i in range(5):\n    move_right()\n",
    grid: [
      "########",
      "#S.....#",
      "#.####.#",
      "#.####.#",
      "#.....G#",
      "########",
    ],
    maxActions: 9,
    maxLines: 6,
    solution: `for i in range(5):
    move_right()
for i in range(3):
    move_down()
`,
  },
  {
    id: 10,
    title: "Selama Belum Sampai",
    topic: "while",
    instruction:
      "Gunakan while not at_goal(): supaya karakter terus berjalan sampai tiba di bendera.",
    hint: "at_goal() bernilai True kalau karakter sudah berdiri di tile tujuan.",
    starter: "while not at_goal():\n    move_right()\n",
    grid: ["###########", "#S.......G#", "#.........#", "###########"],
    maxActions: 9,
    maxLines: 4,
    solution: `while not at_goal():
    move_right()
`,
  },
  {
    id: 11,
    title: "Jalan Sampai Mentok",
    topic: "while",
    instruction:
      "is_blocked(\"right\") bernilai True kalau jalan ke kanan terhalang. Pakai itu sebagai syarat perulangan: maju terus sampai mentok, lalu turun.",
    hint: "Dua perulangan: while not is_blocked(\"right\"): move_right(), lalu while not is_blocked(\"down\"): move_down().",
    starter: "while not is_blocked(\"right\"):\n    move_right()\n",
    grid: [
      "#########",
      "#S......#",
      "#######.#",
      "#.......#",
      "#.#####.#",
      "#......G#",
      "#########",
    ],
    maxActions: 11,
    maxLines: 6,
    solution: `while not is_blocked("right"):
    move_right()
while not is_blocked("down"):
    move_down()
`,
  },
  {
    id: 12,
    title: "Hancurkan Rintangan",
    topic: "while",
    instruction:
      "can_attack(\"right\") bernilai True kalau tile di kanan adalah batu. Pakai sensor itu sebagai syarat while sebelum berjalan.",
    hint: "while can_attack(\"right\"): attack(\"right\") — attack juga boleh diberi arah sebagai argumen.",
    starter: "while can_attack(\"right\"):\n    attack(\"right\")\n",
    grid: ["##########", "#SR.....G#", "##########"],
    maxActions: 10,
    maxLines: 6,
    solution: `while can_attack("right"):
    attack("right")
while not is_blocked("right"):
    move_right()
`,
  },
  {
    id: 13,
    title: "Kalau Mentok, Serang",
    topic: "if",
    instruction:
      "Gabungkan sensor dengan if/else: kalau jalan ke kanan terhalang, serang; kalau tidak, jalan terus.",
    hint: "while not at_goal(): lalu if is_blocked(\"right\"): attack(\"right\") else: move_right()",
    starter: "while not at_goal():\n    if is_blocked(\"right\"):\n        attack(\"right\")\n    else:\n        move_right()\n",
    grid: ["###########", "#S..R..R.G#", "###########"],
    maxActions: 11,
    maxLines: 8,
    solution: `while not at_goal():
    if is_blocked("right"):
        attack("right")
    else:
        move_right()
`,
  },
  {
    id: 14,
    title: "Fungsi Bantuan",
    topic: "def",
    instruction:
      "Buat fungsi sendiri dengan def, misalnya untuk maju sampai mentok sambil menghancurkan batu, lalu panggil berulang.",
    hint: "def maju_sampai_mentok(): ... lalu while not at_goal(): maju_sampai_mentok()",
    starter: "def maju_sampai_mentok():\n    while can_attack(\"right\"):\n        attack(\"right\")\n",
    grid: ["#############", "#S..R...R..G#", "#############"],
    maxActions: 13,
    maxLines: 12,
    solution: `def maju_sampai_mentok():
    while can_attack("right"):
        attack("right")
    while not is_blocked("right"):
        move_right()

while not at_goal():
    maju_sampai_mentok()
`,
  },
  {
    id: 15,
    title: "Petualangan Lengkap",
    topic: "semua",
    instruction:
      "Kombinasi terakhir: hancurkan batu, ambil kunci (K), lewati pintu (D), lalu raih bendera. Koin (C) hanya bonus.",
    hint: "Buat fungsi untuk membersihkan batu, lalu ulangi: kalau kanan terhalang, turun; kalau tidak, jalan.",
    starter: "",
    grid: [
      "###############",
      "#SR...K..#.C..#",
      "#........#....#",
      "#........D...G#",
      "###############",
    ],
    facing: "right",
    maxActions: 16,
    maxLines: 14,
    solution: `def bersihkan(arah):
    while can_attack(arah):
        attack(arah)

bersihkan("right")

while not at_goal():
    if is_blocked("right"):
        move_down()
    else:
        move_right()
`,
  },
];

/** Jumlah level yang tersedia. */
export const LEVEL_COUNT = LEVELS.length;

/** Mengambil level berdasarkan nomor (1..LEVEL_COUNT). */
export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

/** Ringkasan daftar level untuk menu. */
export function listLevels() {
  return LEVELS.map(({ id, title, topic }) => ({ id, title, topic }));
}
