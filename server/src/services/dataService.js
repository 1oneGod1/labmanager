const providerName = 'sqlite';
const provider = require('./sqliteService');

function isStorageAvailable() {
  if (typeof provider.isStorageAvailable === 'function') return provider.isStorageAvailable();
  return true;
}

function initialize(options) {
  if (typeof provider.initialize === 'function') return provider.initialize(options);
  const available = isStorageAvailable();
  console.log(`[DATA] Provider ${providerName}: ${available ? 'aktif' : 'tidak tersedia'}`);
  return { provider: providerName, mode: 'cloud', available };
}

async function shutdown(options) {
  if (typeof provider.shutdown === 'function') await provider.shutdown(options);
}

function getStorageStatus() {
  if (typeof provider.getStorageStatus === 'function') return provider.getStorageStatus();
  return { provider: providerName, mode: 'local', available: isStorageAvailable() };
}

async function createBackup(reason = 'manual') {
  if (typeof provider.createBackup !== 'function') {
    throw new Error(`Backup lokal tidak tersedia untuk provider ${providerName}.`);
  }
  return provider.createBackup(reason);
}

module.exports = {
  ...provider,
  providerName,
  initialize,
  shutdown,
  isStorageAvailable,
  getStorageStatus,
  createBackup,
};
