const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainPath = path.resolve(__dirname, '..', 'electron', 'main.js');
const source = fs.readFileSync(mainPath, 'utf8');

assert.match(source, /pending-session-logout\.json/);
assert.match(source, /reason:\s*'unclean_shutdown',[\s\S]*reuse_initial_check:\s*true/);
assert.match(source, /session_id:\s*record\.session_id,[\s\S]*reason:\s*record\.reason,[\s\S]*reuse_initial_check:/);
assert.match(source, /app\.on\('session-end',[\s\S]*logoutActiveSessionOnQuit\('system_shutdown'\)/);
assert.match(source, /retryPendingSessionLogout\(\)[\s\S]*startNetSupportMonitor\(\)/);
assert.match(source, /await logoutActiveSessionOnQuit\(command === 'restart' \? 'system_restart' : 'system_shutdown'\)/);

const logoutHandler = source.match(/ipcMain\.on\('do-logout',[\s\S]*?mainWindow\.webContents\.send\('return-to-login'\);\s*}\);/)?.[0] || '';
assert.ok(logoutHandler, 'Handler logout lokal harus tersedia.');
assert.ok(
  logoutHandler.indexOf('const sessionIdToClose = activeSessionId;') < logoutHandler.indexOf('activeSessionId = null;'),
  'ID sesi harus disalin sebelum state aktif dikosongkan.',
);
assert.match(logoutHandler, /queueSessionLogout\(sessionIdToClose, 'student_logout', false\)/);

console.log('Shutdown/restart session logout recovery checks: PASS');
