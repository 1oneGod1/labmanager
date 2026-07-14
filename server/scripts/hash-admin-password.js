#!/usr/bin/env node
/**
 * Helper script untuk generate bcrypt hash dari admin password.
 * 
 * Usage:
 *   node scripts/hash-admin-password.js <password>
 * 
 * Contoh:
 *   node scripts/hash-admin-password.js MySecretPassword123
 * 
 * Lalu copy hash yang dihasilkan ke file .env:
 *   ADMIN_PASSWORD=$2b$10$xxxxx...
 */

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

async function main() {
  const password = process.argv[2];

  if (!password) {
    console.error('❌ Harap masukkan password sebagai argumen.');
    console.error('   Usage: node scripts/hash-admin-password.js <password>');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    console.log('');
    console.log('✅ Bcrypt hash berhasil dibuat!');
    console.log('');
    console.log('   Hash:');
    console.log(`   ${hash}`);
    console.log('');
    console.log('   Salin ke file server/.env:');
    console.log(`   ADMIN_PASSWORD=${hash}`);
    console.log('');
  } catch (err) {
    console.error('❌ Gagal membuat hash:', err.message);
    process.exit(1);
  }
}

main();
