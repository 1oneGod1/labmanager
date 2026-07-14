# Panduan Auto-Update LabKom

Sumber pembaruan resmi adalah GitHub Releases pada `1oneGod1/labmanager`.

## Yang dilakukan pemilik aplikasi

1. Edit dan uji kode.
2. Commit perubahan.
3. Push ke branch `main`.
4. Pantau workflow **Release LabKom Apps** pada tab Actions.

Jika perubahan menyentuh aplikasi atau server, workflow otomatis membuat GitHub Release baru yang berisi kedua installer. Nomor versi build dibuat otomatis dan selalu lebih baru dari build sebelumnya.

## Yang terjadi pada PC siswa

- Aplikasi memeriksa kanal `client` setelah startup dan setiap 4 jam.
- Versi baru diumumkan lewat notifikasi Windows dan panel di dalam aplikasi.
- Menu **Pengaturan** pada layar setup/login menyediakan pemeriksaan manual.
- Update otomatis dapat diaktifkan atau dimatikan per-PC.
- Paket yang sudah selesai diunduh dapat dipasang langsung atau saat aplikasi ditutup.

## Yang terjadi pada PC Admin

- Aplikasi memeriksa kanal `admin` setelah startup.
- Kepala Lab dapat mengunduh lalu memasang update dari dashboard.

## Aset Release yang wajib ada

- `LabKom Siswa Setup <versi>.exe`
- `LabKom Admin - Dashboard Setup <versi>.exe`
- file `.blockmap` untuk kedua installer
- `client.yml`
- `admin.yml`

Jangan mengganti nama atau menghapus aset metadata tersebut. Release juga harus berstatus published, bukan draft.

## Catatan keamanan

Workflow menggunakan `GITHUB_TOKEN` otomatis dari GitHub Actions. Jangan menaruh personal access token, file `.env`, service account Firebase, atau kunci pairing di repository.
