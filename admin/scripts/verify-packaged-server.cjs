const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { createRequire } = require('module');
const { spawn } = require('child_process');

const adminRoot = path.resolve(__dirname, '..');
const unpackedRoot = path.join(adminRoot, 'dist-electron', 'win-unpacked');
const serverRoot = path.join(unpackedRoot, 'resources', 'server');
const serverEntry = path.join(serverRoot, 'src', 'index.js');
const executable = path.join(unpackedRoot, 'LabKom Admin - Dashboard.exe');

function assertFile(candidate, label) {
  if (!fs.existsSync(candidate)) throw new Error(`${label} tidak ditemukan: ${candidate}`);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

function requestJson(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : '';
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {}),
        ...(body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(responseBody) });
        } catch (error) {
          reject(new Error(`Respons bukan JSON: ${responseBody.slice(0, 200)}`));
        }
      });
    });
    request.once('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('Request timeout')));
    if (body) request.write(body);
    request.end();
  });
}

async function waitForServer(port, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Backend berhenti dengan kode ${child.exitCode}.`);
    try {
      const response = await requestJson(port, '/');
      if (response.status === 200) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Backend paket tidak sehat setelah 20 detik.');
}

async function main() {
  assertFile(serverEntry, 'Entry backend paket');
  assertFile(executable, 'Executable Admin unpacked');

  const requireFromServer = createRequire(serverEntry);
  for (const dependency of ['dotenv', 'express', 'cors', 'socket.io', 'bcryptjs']) {
    const resolved = requireFromServer.resolve(dependency);
    if (!resolved.toLowerCase().startsWith(serverRoot.toLowerCase() + path.sep)) {
      throw new Error(`${dependency} tidak berasal dari paket server: ${resolved}`);
    }
    requireFromServer(dependency);
  }

  const port = await reservePort();
  const envPath = path.join(adminRoot, 'dist-electron', 'verify-server.env');
  const dataDir = fs.mkdtempSync(path.join(adminRoot, 'dist-electron', 'verify-data-'));
  fs.writeFileSync(envPath, [
    `PORT=${port}`,
    'NODE_ENV=production',
    'ADMIN_PASSWORD=$2b$10$x7A71CHObExmQ7nqG0/pduYE1ye3TjjQqeMGa5qtWsA9q.ALnu6Te',
    'CLIENT_REGISTRATION_KEY=verification-key-12345678901234567890',
    'LABKOM_DATA_PROVIDER=sqlite',
    '',
  ].join('\r\n'), 'utf8');

  let stderr = '';
  const child = spawn(executable, [serverEntry], {
    cwd: serverRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LABKOM_ENV_PATH: envPath,
      NODE_ENV: 'production',
      LABKOM_DATA_DIR: dataDir,
      LABKOM_BACKUP_DIR: path.join(dataDir, 'backups'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    const health = await waitForServer(port, child);
    if (health.body?.storage?.provider !== 'sqlite' || health.body?.storage?.available !== true) {
      throw new Error(`SQLite paket tidak aktif: ${JSON.stringify(health.body?.storage)}`);
    }
    const valid = await requestJson(port, '/api/admin/login', {
      method: 'POST',
      body: { password: 'kepalalab123' },
    });
    if (valid.status !== 200 || !valid.body?.success || !valid.body?.token) {
      throw new Error(`Login admin paket gagal: HTTP ${valid.status}`);
    }

    const invalid = await requestJson(port, '/api/admin/login', {
      method: 'POST',
      body: { password: 'password-salah' },
    });
    if (invalid.status !== 401 || invalid.body?.success !== false) {
      throw new Error(`Password salah tidak ditolak: HTTP ${invalid.status}`);
    }

    const authHeaders = { Authorization: `Bearer ${valid.body.token}` };
    const branding = await requestJson(port, '/api/admin/branding', {
      method: 'PUT',
      headers: authHeaders,
      body: {
        product_name: 'EduLab Verify',
        school_name: 'Sekolah Verifikasi',
        lab_name: 'Lab Verifikasi',
        admin_label: 'Pusat Kendali',
        student_label: 'Portal Siswa',
        support_text: 'Hubungi petugas.',
        primary_color: '#123456',
        accent_color: '#fedcba',
      },
    });
    if (branding.status !== 200 || branding.body?.data?.school_name !== 'Sekolah Verifikasi') {
      throw new Error(`White-label paket gagal disimpan: HTTP ${branding.status}`);
    }

    const publicBranding = await requestJson(port, '/api/branding');
    if (publicBranding.status !== 200 || publicBranding.body?.data?.product_name !== 'EduLab Verify') {
      throw new Error(`White-label paket gagal dibaca: HTTP ${publicBranding.status}`);
    }

    const unsafeBranding = await requestJson(port, '/api/admin/branding', {
      method: 'PUT',
      headers: authHeaders,
      body: { logo_data_url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    });
    if (unsafeBranding.status !== 400 || unsafeBranding.body?.success !== false) {
      throw new Error(`Logo SVG tidak ditolak: HTTP ${unsafeBranding.status}`);
    }

    const created = await requestJson(port, '/api/students', {
      method: 'POST',
      headers: authHeaders,
      body: { nis: 'VERIFY-001', nama_lengkap: 'Siswa Verifikasi', kelas: 'TEST', password: 'rahasia123' },
    });
    if (created.status !== 201 || !created.body?.data?.id) {
      throw new Error(`CRUD SQLite paket gagal membuat siswa: HTTP ${created.status}`);
    }

    const students = await requestJson(port, '/api/students', { headers: authHeaders });
    if (students.status !== 200 || students.body?.data?.[0]?.nis !== 'VERIFY-001') {
      throw new Error(`CRUD SQLite paket gagal membaca siswa: HTTP ${students.status}`);
    }

    const pairing = await requestJson(port, '/api/admin/pairing-key', { headers: authHeaders });
    if (pairing.status !== 200 || pairing.body?.data?.pairing_key !== 'verification-key-12345678901234567890') {
      throw new Error(`Kunci pairing paket gagal dibaca: HTTP ${pairing.status}`);
    }

    const device = await requestJson(port, '/api/auth/device-register', {
      method: 'POST',
      headers: { 'X-LabKom-Registration-Key': pairing.body.data.pairing_key },
      body: { device_id: '0123456789abcdef0123456789abcdef', pc_name: 'PC-VERIFY-01' },
    });
    if (device.status !== 200 || !device.body?.data?.token) {
      throw new Error(`Pairing perangkat paket gagal: HTTP ${device.status}`);
    }

    const studentLogin = await requestJson(port, '/api/auth/login', {
      method: 'POST',
      headers: { Authorization: `Bearer ${device.body.data.token}` },
      body: { nis: 'VERIFY-001', password: 'rahasia123', pc_name: 'PC-PALSU' },
    });
    if (studentLogin.status !== 200 || studentLogin.body?.data?.actual_pc_name !== 'PC-VERIFY-01') {
      throw new Error(`Login siswa lokal paket gagal: HTTP ${studentLogin.status}`);
    }

    const backup = await requestJson(port, '/api/admin/storage/backup', {
      method: 'POST',
      headers: authHeaders,
    });
    if (backup.status !== 201 || !backup.body?.data?.path || !fs.existsSync(backup.body.data.path)) {
      throw new Error(`Backup SQLite paket gagal: HTTP ${backup.status}`);
    }
  } catch (error) {
    const detail = stderr.trim() ? `\n${stderr.trim().slice(-2000)}` : '';
    throw new Error(`${error.message}${detail}`);
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(envPath, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log('Packaged backend startup, white-label, SQLite CRUD, pairing, student login, backup, and admin authentication: PASS');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
