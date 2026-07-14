const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER_ROOT = path.resolve(__dirname, '..', '..');

function normalizeConfiguredPath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const hasMatchingQuotes = (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  );

  return hasMatchingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
}

function resolveServiceAccountPath(value, serverRoot = DEFAULT_SERVER_ROOT) {
  const configuredPath = normalizeConfiguredPath(value);
  if (!configuredPath) {
    throw new Error('Path service account kosong.');
  }

  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(serverRoot, configuredPath);
}

function readServiceAccount(credentialPath) {
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('File service account tidak ditemukan pada path yang dikonfigurasi.');
    }
    throw new Error('File service account tidak dapat dibaca sebagai JSON yang valid.');
  }

  const requiredFields = ['type', 'project_id', 'client_email', 'private_key'];
  if (parsed.type !== 'service_account' || requiredFields.some((field) => !parsed[field])) {
    throw new Error('File credential bukan service account Firebase yang valid.');
  }

  return parsed;
}

module.exports = {
  DEFAULT_SERVER_ROOT,
  normalizeConfiguredPath,
  resolveServiceAccountPath,
  readServiceAccount,
};
