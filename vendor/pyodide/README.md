# Pyodide 314.0.7 (salinan lokal)

Folder ini berisi salinan resmi Pyodide — mesin CPython yang dikompilasi ke WebAssembly —
supaya halaman **Python Adventure** bisa berjalan tanpa internet.

| Berkas | Ukuran (byte) | SHA-256 (12 karakter pertama) |
| --- | --- | --- |
| `pyodide.mjs` | 17.931 | `6f1d60f7bf52` |
| `pyodide.asm.mjs` | 1.250.344 | `f7cdc8ece806` |
| `pyodide.asm.wasm` | 9.598.218 | `cc36e3cab04f` |
| `python_stdlib.zip` | 2.545.637 | `fa1957e57770` |
| `pyodide-lock.json` | 119.077 | `5dc2fc119108` |

Isi khusus: Python **3.14.2**, ABI `2026_0`, platform `emscripten_5_0_3` (357 paket di lock).

## Asal berkas

Diambil dari paket resmi `pyodide@314.0.7` di npm (registri resmi proyek Pyodide);
CDN jsDelivr menyajikan berkas yang sama pada
`https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`.

## Memperbarui / memeriksa

```bash
node scripts/download-pyodide.mjs --verify     # periksa ukuran + SHA-256 berkas di folder ini
node scripts/download-pyodide.mjs              # unduh ulang dari CDN resmi (jsDelivr → unpkg)
node scripts/download-pyodide.mjs --force      # paksa unduh walau hash berbeda (hati-hati!)
```

Kalau versi diganti, samakan juga `PYODIDE_VERSION` dan `PYODIDE_FILES` di
`games/python-adventure/runner.js`.

## Lisensi

Pyodide: **MPL-2.0** — <https://github.com/pyodide/pyodide>
CPython (di dalam `pyodide.asm.wasm` + `python_stdlib.zip`): **PSF License**.
Berkas di folder ini disertakan apa adanya tanpa perubahan.
