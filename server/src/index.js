const path = require('path');
require('dotenv').config({
  path: process.env.LABKOM_ENV_PATH || path.resolve(__dirname, '..', '.env'),
});
const express = require('express');
const cors    = require('cors');
const os      = require('os');
const http    = require('http');
const dataService = require('./services/dataService');

try {
  dataService.initialize({ scheduleBackups: process.env.NODE_ENV !== 'test' });
} catch (error) {
  console.error('[DATA] Gagal menginisialisasi penyimpanan:', error.message);
  process.exitCode = 1;
  throw error;
}

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const authRoutes       = require('./routes/auth');
const sessionRoutes    = require('./routes/sessions');
const adminRoutes      = require('./routes/admin');
const monitoringRoutes = require('./routes/monitoring');
const studentsRoutes   = require('./routes/students');
const historyRoutes    = require('./routes/history');
const controlRoutes    = require('./routes/control');
const checksRoutes     = require('./routes/checks');
const screensRoutes    = require('./routes/screens');
const clientCmdRoutes  = require('./routes/clientcmd');
const activitiesRoutes = require('./routes/activities');
const brandingRoutes   = require('./routes/branding');
const { attachRealtimeHub } = require('./realtimeHub');

const app  = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
app.disable('x-powered-by');

// =====================
// Middleware
// =====================
// CORS: Hanya izinkan localhost, LAN, dan origin internal Electron.
const ALLOWED_ORIGIN_PATTERNS = [
  /^labkom:\/\/app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
];
app.use(cors({
  origin: (origin, callback) => {
    // Tanpa origin digunakan request same-origin/non-browser yang sah.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGIN_PATTERNS.some(p => p.test(origin))) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));          // screenshots butuh ruang lebih
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Request logger sederhana
app.use((req, _res, next) => {
  const now = new Date().toLocaleTimeString('id-ID');
  console.log(`[${now}] ${req.method} ${req.url}`);
  next();
});

// =====================
// Routes
// =====================
app.get('/', (_req, res) => {
  const storage = dataService.getStorageStatus();
  res.json({
    message: 'Labkom Server berjalan!',
    version: '1.2.0',
    storage: {
      provider: storage.provider,
      mode: storage.mode,
      available: storage.available,
    },
  });
});

app.use('/api/auth',       authRoutes);
app.use('/api/sessions',   sessionRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/students',   studentsRoutes);
app.use('/api/history',    historyRoutes);
app.use('/api/control',    controlRoutes);
app.use('/api/checks',     checksRoutes);
app.use('/api/screens',    screensRoutes);
app.use('/api/client-cmd', clientCmdRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/branding',   brandingRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' });
});

// =====================
const realtimeHub = attachRealtimeHub(server);
app.set('realtimeHub', realtimeHub);

// Start Server
// =====================
server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLanIp();
  console.log('========================================');
  console.log(`  LABKOM SERVER berjalan di port ${PORT}`);
  console.log(`  Lokal : http://localhost:${PORT}`);
  console.log(`  LAN   : http://${lanIp}:${PORT}`);
  console.log('========================================');
});

let shutdownStarted = false;
async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`[SERVER] Menerima ${signal}, menutup server dan menyimpan backup...`);
  server.close(() => {});
  const forceExit = setTimeout(() => process.exit(0), 3500);
  forceExit.unref();
  try {
    await dataService.shutdown({ backup: true });
  } catch (error) {
    console.warn('[DATA] Gagal menutup penyimpanan dengan bersih:', error.message);
  }
  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
