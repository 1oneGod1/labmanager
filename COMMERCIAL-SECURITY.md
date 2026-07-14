# Panduan White-label dan Keamanan Komersial LabKom

## Mengganti identitas sekolah

1. Buka aplikasi **LabKom Admin** dan login.
2. Pilih menu **Identitas**.
3. Isi nama produk, nama sekolah, nama laboratorium, kontak dukungan, warna merek, serta logo.
4. Simpan perubahan. Identitas disimpan pada server lokal Admin dan dikirim otomatis ke aplikasi Siswa yang terhubung.

Logo hanya menerima PNG, JPEG, atau WebP dengan ukuran maksimal 512 KB. SVG tidak diterima untuk mencegah penyisipan skrip. Tampilan Admin dan Siswa tetap memiliki identitas generik yang aman sebelum konfigurasi sekolah dilakukan.

## Perlindungan data yang sudah diterapkan

- Data operasional disimpan lokal pada SQLite di komputer Admin.
- Token perangkat dan kunci pairing pada aplikasi Siswa dilindungi menggunakan Windows DPAPI melalui Electron `safeStorage`.
- Password Admin disimpan sebagai hash bcrypt, bukan teks biasa.
- Password keluar darurat Siswa dibandingkan sebagai hash SHA-256 dan tidak ditulis sebagai teks biasa di source produksi.
- Renderer Electron menggunakan context isolation, sandbox, CSP, pembatasan izin, serta Electron fuses.
- API menonaktifkan header identitas server, membatasi origin jaringan lokal, dan memakai header keamanan.
- File database, environment, sertifikat, private key, dan kredensial cloud diblokir oleh `.gitignore`.

## Sebelum dijual ke pelanggan

1. Ganti password Admin dan password keluar darurat untuk setiap pelanggan. Jangan memakai password contoh yang sama untuk semua instalasi komersial.
2. Buat kunci pairing acak yang berbeda untuk setiap sekolah.
3. Simpan source code pada repository **private**.
4. Gunakan repository atau layanan terpisah yang hanya memuat installer publik untuk pembaruan otomatis. Jangan menanam GitHub token repository private ke aplikasi pelanggan.
5. Tanda tangani installer dan executable dengan sertifikat Windows code-signing milik penerbit.
6. Uji backup dan pemulihan data sebelum instalasi produksi.

## Batas perlindungan source code

ASAR, minifikasi, sandbox, dan Electron fuses memperkecil risiko perubahan atau ekstraksi kasual, tetapi bukan enkripsi source code. Aplikasi Electron yang didistribusikan tetap dapat dianalisis oleh pihak yang memiliki komputer tersebut. Perlindungan komersial yang tepat adalah repository source private, distribusi binary terpisah, code signing, perjanjian lisensi, dan—jika diperlukan—layanan aktivasi yang menyimpan aturan lisensi di server milik penerbit.

Jangan pernah memasukkan service-account JSON, private key, database pelanggan, token GitHub, atau nilai asli `server.env` ke repository maupun installer.
