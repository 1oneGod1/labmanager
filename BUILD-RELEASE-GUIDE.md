# Panduan Build dan Release LabKom

Repository produksi: `https://github.com/1oneGod1/labmanager`

## Struktur aplikasi

| Komponen | Folder | Isi |
|---|---|---|
| Admin | `admin/` | Dashboard Electron dan backend server terbundel |
| Siswa | `client/` | Aplikasi login/kiosk Electron untuk PC siswa |
| Server | `server/` | Express API dan Socket.IO yang dibawa installer Admin |

## Rilis otomatis dari GitHub

Workflow `.github/workflows/release.yml` berjalan otomatis setiap ada push ke branch `main` yang mengubah folder `admin`, `client`, `server`, atau workflow rilis.

Workflow tersebut akan:

1. Membuat nomor versi build yang selalu meningkat.
2. Membangun installer Siswa dan Admin pada Windows runner.
3. Menerbitkan keduanya pada satu GitHub Release berstatus published.
4. Mengunggah metadata kanal `client.yml` dan `admin.yml` agar kedua aplikasi tidak saling mengambil installer.

Alur kerja harian:

```powershell
git add -A
git commit -m "feat: jelaskan perubahan"
git push origin main
```

Setelah push, lihat status pada GitHub > Actions > **Release LabKom Apps**. Jangan hapus file `.yml` atau `.blockmap` dari aset Release karena file tersebut dipakai updater.

Untuk menjalankan ulang secara manual, buka Actions > Release LabKom Apps > Run workflow. Kolom versi boleh dikosongkan agar dibuat otomatis.

## Cara aplikasi menerima update

### PC Siswa

- Memeriksa update 30 detik setelah aplikasi dimulai dan setiap 4 jam.
- Pengaturan dapat dibuka dari layar setup atau login.
- Opsi per-PC: alamat server, mulai bersama Windows, update otomatis, dan notifikasi update.
- Jika update otomatis aktif, paket diunduh di belakang layar.
- Setelah selesai, siswa mendapat notifikasi dan dapat memasang saat itu juga; jika tidak, update dipasang saat aplikasi ditutup.

### Admin

- Memeriksa update setelah aplikasi dimulai.
- Menampilkan status versi baru di dashboard.
- Download dan restart tetap dikonfirmasi oleh Kepala Lab.

## Build lokal

```powershell
cd server
npm ci

cd ../client
npm ci
npm run electron:build

cd ../admin
npm ci
npm run electron:build
```

Hasil build berada pada `client/dist-electron` dan `admin/dist-electron`.

## Keamanan produksi

- Jangan commit `.env`, service account Firebase, token GitHub, atau kunci pairing.
- Simpan service account di luar repository dan isi path absolut pada `%APPDATA%\LabKom Admin - Dashboard\server.env`.
- Isi `ADMIN_PASSWORD` dengan hash bcrypt.
- Gunakan `CLIENT_REGISTRATION_KEY` acak minimal 32 karakter dan nilai yang sama pada environment PC siswa.
- GitHub Actions memakai `GITHUB_TOKEN` bawaan workflow; tidak perlu menulis personal access token ke file.

## Pemecahan masalah update

- Pastikan workflow hijau dan Release berstatus published, bukan draft.
- Pastikan aset Release memuat installer, `.blockmap`, `client.yml`, dan `admin.yml`.
- Periksa log aplikasi di folder `logs` di bawah `%APPDATA%` masing-masing aplikasi.
- PC siswa memerlukan akses internet ke GitHub Releases untuk menerima pembaruan.
