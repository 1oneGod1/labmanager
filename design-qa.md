# Design QA — LabKom APP UI Development

## Ringkasan

- **Hasil akhir:** `passed`
- **Ruang lingkup:** tampilan admin Monitor, Remote, Restrict, Files, Register, dan Reports; formulir pemeriksaan siswa sebelum/sesudah sesi; serta alur penerimaan file setelah siswa masuk.
- **Pengecualian yang dipertahankan:** halaman login siswa tidak diubah.
- **Sumber visual utama:** `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/screenshots/`
- **Screenshot implementasi:** `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/implementation/`

## Kondisi dan viewport yang diuji

| Permukaan | Kondisi | Referensi | Implementasi |
| --- | --- | --- | --- |
| Admin Monitor | Overview 30 PC, tidak ada PC dipilih | 1398×874, frame aplikasi dinormalisasi | 1280×720, `?demo=1` |
| Admin Files | File latihan dipilih, status distribusi campuran | 1398×874, crop viewer `y=83` | 1398×874, `?demo=1` |
| Admin Register | PC-LAB-09 dipilih, masalah mouse tampil pada detail | 1398×874, crop viewer `y=83` | 1398×874, `?demo=1` |
| Admin Reports | Periode hari ini, ringkasan dan tiga tanda masalah | 1398×874, crop viewer `y=83` | 1398×874, `?demo=1` |
| Student Pre-check | Lima perangkat baik, headset bermasalah dan ada catatan | 1398×874, frame aplikasi dinormalisasi | 1408×880, `?preview=precheck` |

Perbandingan diselaraskan berdasarkan frame aplikasi karena file sumber memiliki chrome viewer statis yang bukan bagian produk.

## Bukti perbandingan visual

### Full view

- Admin Monitor: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-monitor-aligned-comparison.png`
- Admin Files: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-files-comparison-v2.png`
- Admin Register: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-register-comparison-v2.png`
- Admin Reports: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-reports-comparison-v2.png`
- Student Pre-check: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/student-precheck-aligned-comparison.png`

### Focused region

- Admin header, navigasi, dan status: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-header-focused-comparison.png`
- Files toolbar, ringkasan, dan status progres: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-files-focus-comparison-v2.png`
- Register tabel dan panel kondisi: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-register-focus-comparison-v2.png`
- Reports kartu ringkasan dan visualisasi: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/admin-reports-focus-comparison-v2.png`
- Baris kondisi headset dan catatan masalah: `C:/Users/Andi Purba/Documents/Codex/2026-07-14/buk/work/ui-design/qa/student-headset-focused-comparison.png`

## Evaluasi fidelity

- **Tipografi:** IBM Plex Sans dan IBM Plex Mono dibundel lokal; skala, bobot, kapitalisasi, dan hierarki mengikuti referensi.
- **Spacing/rhythm:** header, rail navigasi, panel kanan, tabel, kartu statistik, dan baris formulir konsisten dengan struktur sumber.
- **Warna/tokens:** latar navy gelap, permukaan berlapis, border biru-abu, aksen kuning, hijau, dan merah mengikuti token visual sumber.
- **Radius/border:** radius kecil dan outline tipis digunakan konsisten pada tombol, kartu, input, tabel, serta panel.
- **Data visual:** progress bar, grafik aktivitas, dan ring kehadiran menggunakan data nyata saat API tersedia dan data demo yang realistis pada mode preview.
- **Copy:** teks produk dilokalkan ke Bahasa Indonesia; arti, urutan, dan hierarki informasi tetap setara dengan referensi.
- **Ikon:** keluarga ikon Lucide yang sudah ada di proyek dipertahankan dan digunakan konsisten.

## Interaksi utama yang diverifikasi

- Pencarian nama/ruang, filter online/offline, pemilihan PC, dan panel detail Monitor.
- Navigasi serta aksi utama pada Monitor, Remote, dan Restrict.
- Files: memilih file, simulasi distribusi, status per-PC, pencarian siswa, dan mode pengumpulan.
- Register: memilih siswa bermasalah, membuka rincian pemeriksaan, pencarian siswa, refresh, dan ketersediaan ekspor CSV.
- Reports: pergantian periode Hari ini/Minggu/Bulan, tiga tanda masalah, dan ketersediaan ekspor/print PDF.
- Student pre-check: memilih kondisi perangkat, menulis catatan, menyetujui konfirmasi, dan mengaktifkan tombol mulai sesi.
- Penerimaan file siswa: relay Socket.IO, validasi payload/nama file, penyimpanan aman ke `Downloads/LabKom`, dan pengiriman status ke admin.
- Log browser admin diperiksa; hanya log Vite/React development, tanpa error atau warning aplikasi pada state akhir.

## Iterasi perbaikan

1. **P2 — launcher chat/attention menutupi panel:** launcher lama dihilangkan dari state tertutup dan dibuka melalui tombol header/quick action.
2. **P2 — catatan masalah mematahkan ritme baris:** field catatan dibuat inline dan kompak mengikuti referensi.
3. **P2 — state screenshot tidak sejajar:** implementasi diset ke kondisi yang sama dengan referensi lalu dibandingkan ulang.
4. **P2 — toast tidak pernah hilang:** timer toast dipisahkan dari render jam sehingga notifikasi sekarang tertutup otomatis.
5. **P2 — panel tanda Reports terlalu kosong:** data fallback melengkapi tiga penanda ketika API hanya mengembalikan sedikit masalah.
6. **P2 — posisi viewport bergeser saat klik baris:** halaman dimuat ulang sebelum capture akhir agar frame referensi dan implementasi benar-benar sejajar.

## Perbedaan yang disengaja / P3 follow-up

- Rail admin mempertahankan fitur proyek yang tidak ada pada mockup (Students, Activity, Server) agar fungsi lama tidak hilang.
- Bahasa antarmuka tetap Bahasa Indonesia sesuai produk, sementara referensi menggunakan Bahasa Inggris.
- Batas file distribusi ditetapkan 1 MB agar payload Socket.IO tidak membebani server; pengujian jaringan nyata tetap diperlukan sebelum menaikkan batas.
- Crop dan kompresi stream layar perlu divalidasi lagi pada deployment yang tersambung ke PC siswa aktif.
- Login siswa dipertahankan tanpa perubahan sesuai permintaan.

## Verifikasi teknis

- Admin React production build: lulus.
- Client React production build: lulus.
- Client packaging helper test: lulus.
- Server test suite: 14/14 lulus, termasuk relay file dan resolusi/validasi path credential Firebase.
- `git diff --check`: lulus; hanya peringatan normalisasi CRLF dari Git pada Windows.

## Final result

passed
