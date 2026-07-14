const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeConfiguredPath,
  resolveServiceAccountPath,
  readServiceAccount,
} = require('../src/config/firebaseCredentials');

test('relative Firebase credential paths resolve from the server folder', () => {
  const serverRoot = path.join(path.parse(process.cwd()).root, 'apps', 'labkom', 'server');
  const resolved = resolveServiceAccountPath('../../secrets/firebase.json', serverRoot);

  assert.equal(resolved, path.resolve(serverRoot, '../../secrets/firebase.json'));
});

test('absolute Firebase credential paths are preserved and quoted values are supported', () => {
  const absolutePath = path.resolve('C:/ProgramData/LabKom/secrets/firebase.json');

  assert.equal(normalizeConfiguredPath(`"${absolutePath}"`), absolutePath);
  assert.equal(resolveServiceAccountPath(`"${absolutePath}"`), path.normalize(absolutePath));
});

test('service account reader validates the credential shape without logging its contents', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labkom-firebase-'));
  const credentialPath = path.join(tempDir, 'service-account.json');

  try {
    fs.writeFileSync(credentialPath, JSON.stringify({
      type: 'service_account',
      project_id: 'test-project',
      client_email: 'test@example.invalid',
      private_key: 'test-private-key',
    }));

    const credential = readServiceAccount(credentialPath);
    assert.equal(credential.project_id, 'test-project');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
