// Firebase Admin SDK configuration for Firestore access.

const admin = require('firebase-admin');
const {
  resolveServiceAccountPath,
  readServiceAccount,
} = require('./firebaseCredentials');

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || 'labkom-51250',
};

let firebaseApp;

try {
  if (admin.apps.length === 0) {
    const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (configuredPath) {
      const credentialPath = resolveServiceAccountPath(configuredPath);
      const serviceAccount = readServiceAccount(credentialPath);

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: firebaseConfig.projectId,
      });

      console.log(`[FIREBASE] Inisialisasi berhasil untuk project ${firebaseConfig.projectId}`);
    } else {
      console.warn('[FIREBASE] Service account key belum dikonfigurasi.');
      console.log('[FIREBASE] Set FIREBASE_SERVICE_ACCOUNT_KEY ke path file JSON di luar repository.');
      console.log('[FIREBASE] Aplikasi berjalan tanpa database persistence (hanya LAN server).');
    }
  } else {
    firebaseApp = admin.app();
  }
} catch (error) {
  console.error('[FIREBASE] Gagal inisialisasi:', error.message);
  console.log('[FIREBASE] Aplikasi berjalan tanpa database persistence (hanya LAN server).');
}

const db = firebaseApp ? admin.firestore() : null;

if (db) {
  db.settings({
    ignoreUndefinedProperties: true,
  });
}

module.exports = {
  admin,
  db,
  firebaseApp,
};
