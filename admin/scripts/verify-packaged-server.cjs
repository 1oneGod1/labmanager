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
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      } : {},
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
  for (const dependency of ['dotenv', 'express', 'cors', 'socket.io', 'firebase-admin', 'bcryptjs']) {
    const resolved = requireFromServer.resolve(dependency);
    if (!resolved.toLowerCase().startsWith(serverRoot.toLowerCase() + path.sep)) {
      throw new Error(`${dependency} tidak berasal dari paket server: ${resolved}`);
    }
    requireFromServer(dependency);
  }

  const port = await reservePort();
  const envPath = path.join(adminRoot, 'dist-electron', 'verify-server.env');
  fs.writeFileSync(envPath, [
    `PORT=${port}`,
    'NODE_ENV=production',
    'ADMIN_PASSWORD=$2b$10$x7A71CHObExmQ7nqG0/pduYE1ye3TjjQqeMGa5qtWsA9q.ALnu6Te',
    'CLIENT_REGISTRATION_KEY=verification-key-12345678901234567890',
    'FIREBASE_PROJECT_ID=labkom-51250',
    'FIREBASE_SERVICE_ACCOUNT_KEY=',
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForServer(port, child);
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
  } catch (error) {
    const detail = stderr.trim() ? `\n${stderr.trim().slice(-2000)}` : '';
    throw new Error(`${error.message}${detail}`);
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(envPath, { force: true });
  }

  console.log('Packaged backend startup and admin authentication: PASS');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
