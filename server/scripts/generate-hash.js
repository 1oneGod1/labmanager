/**
 * Jalankan script ini SATU KALI untuk generate hash password siswa dummy
 * Perintah: npm run generate-hash
 *
 * Lalu copy hasil SQL-nya ke phpMyAdmin dan Execute
 */

const bcrypt = require('bcryptjs');

const passwords = [
  { nis: '10001', password: 'budi123'  },
  { nis: '10002', password: 'siti456'  },
  { nis: '10003', password: 'ahmad789' },
  { nis: '10004', password: 'dewi321'  },
];

async function generateHashes() {
  console.log('\n-- Jalankan SQL berikut di phpMyAdmin:\n');

  for (const student of passwords) {
    const hash = await bcrypt.hash(student.password, 10);
    console.log(`-- NIS: ${student.nis} | Password: ${student.password}`);
    console.log(`UPDATE students SET password_hash = '${hash}' WHERE nis = '${student.nis}';\n`);
  }

  console.log('-- Selesai! Copy semua baris UPDATE di atas ke phpMyAdmin.\n');
}

generateHashes();
