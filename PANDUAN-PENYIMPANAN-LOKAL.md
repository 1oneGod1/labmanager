# Panduan Penyimpanan Lokal LabKom

LabKom versi 1.2 menggunakan SQLite lokal sebagai penyimpanan bawaan. Firebase tidak diperlukan untuk menambah siswa, login siswa, monitoring, riwayat, pengecekan fasilitas, kebijakan, aktivitas, chat, atau pemetaan komputer.

## Lokasi data

Pada aplikasi Admin terinstal, file utama berada di:

```text
%APPDATA%\LabKom Admin - Dashboard\data\labkom.db
```

Backup otomatis berada di:

```text
%APPDATA%\LabKom Admin - Dashboard\backups
```

Jangan memindahkan `labkom.db` ketika aplikasi Admin sedang berjalan. Database hanya perlu berada pada komputer Admin; komputer siswa mengaksesnya melalui backend pada jaringan LAN.

## Backup

- Backup dibuat saat database pertama kali aktif, setiap 24 jam, saat Admin ditutup, dan saat tombol **Backup Sekarang** ditekan.
- Backup disimpan selama 30 hari secara bawaan.
- Lokasi database, ukuran, waktu backup terakhir, dan tombol backup tersedia pada menu **Server** di aplikasi Admin.
- Salin folder backup secara berkala ke flashdisk terenkripsi atau penyimpanan cadangan yang hanya dapat diakses kepala lab.

Untuk memulihkan backup:

1. Tutup aplikasi LabKom Admin dan pastikan port 3001 sudah berhenti.
2. Simpan salinan `labkom.db` yang lama sebagai cadangan tambahan.
3. Salin salah satu file `labkom-backup-*.db` ke folder `data`.
4. Ubah nama salinan tersebut menjadi `labkom.db`.
5. Buka kembali LabKom Admin dan periksa data siswa serta riwayat.

## Konfigurasi LAN

1. Jalankan LabKom Admin pada satu komputer yang ditetapkan sebagai server.
2. Gunakan alamat IP yang ditampilkan pada menu **Server**, misalnya `http://192.168.1.10:3001`.
3. Salin **Kunci Pairing PC Siswa** yang ditampilkan pada menu yang sama.
4. Pada setiap PC siswa, buka **Pengaturan aplikasi**, masukkan kunci pairing, lalu simpan.
5. Masukkan alamat Admin bila deteksi otomatis belum berhasil.
6. Izinkan port TCP 3001 hanya pada profil jaringan Private/LAN di Windows Firewall.
7. Sebaiknya tetapkan alamat IP komputer Admin melalui reservasi DHCP agar alamat tidak berubah.

## Keamanan

- Gunakan akun Windows khusus Admin dan aktifkan BitLocker pada komputer Admin bila tersedia.
- Jangan membagikan folder database melalui Windows file sharing.
- Ubah password Admin dan password keluar darurat setelah tahap pemasangan selesai.
- Service account Firebase lama tidak digunakan oleh mode lokal. Hapus file key yang tidak diperlukan dan pastikan key yang pernah bocor sudah dicabut di Google Cloud Console.

## Konfigurasi lanjutan

Nilai berikut dapat diubah dalam `%APPDATA%\LabKom Admin - Dashboard\server.env`:

```env
LABKOM_DATA_PROVIDER=sqlite
LABKOM_BACKUP_RETENTION_DAYS=30
LABKOM_BACKUP_INTERVAL_HOURS=24
```

Biarkan `LABKOM_DATABASE_FILE` kosong agar aplikasi menentukan lokasi database yang aman secara otomatis.
