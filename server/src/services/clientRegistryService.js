const ONLINE_TTL_MS = 30000;
const clientRegistry = new Map();
const POWER_STATES = new Set(['awake', 'sleeping']);
const SESSION_STATES = new Set(['login', 'active']);

function normalizePcName(pcName) {
  return String(pcName || '').trim().toUpperCase();
}

function normalizeMac(mac) {
  return String(mac || '')
    .trim()
    .replace(/-/g, ':')
    .toUpperCase();
}

function normalizeState(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function upsertClient(entry = {}) {
  const normalizedPcName = normalizePcName(entry.pc_name);
  if (!normalizedPcName) return null;

  const now = Date.now();
  const existing = clientRegistry.get(normalizedPcName) || {
    pc_name: normalizedPcName,
    mac: null,
    ip: null,
    student_name: null,
    socket_id: null,
    source: null,
    power_state: 'awake',
    session_state: 'login',
    power_state_changed_at: now,
    first_seen: now,
    last_seen: now,
    connected: false,
  };

  const next = {
    ...existing,
    pc_name: normalizedPcName,
    last_seen: now,
    connected: true,
  };

  const powerState = entry.power_state === undefined
    ? (existing.power_state || 'awake')
    : normalizeState(entry.power_state, POWER_STATES, existing.power_state || 'awake');
  const sessionState = normalizeState(entry.session_state, SESSION_STATES, existing.session_state || 'login');
  next.power_state = powerState;
  next.session_state = sessionState;
  if (powerState !== existing.power_state) next.power_state_changed_at = now;

  if (entry.mac !== undefined) next.mac = normalizeMac(entry.mac) || existing.mac || null;
  if (entry.ip !== undefined) next.ip = entry.ip || existing.ip || null;
  if (entry.student_name !== undefined) next.student_name = entry.student_name || null;
  if (entry.socket_id !== undefined) next.socket_id = entry.socket_id || null;
  if (entry.source !== undefined) next.source = entry.source || null;

  clientRegistry.set(normalizedPcName, next);
  return { ...next, is_online: true };
}

function markClientDisconnected(pcName, socketId = null) {
  const normalizedPcName = normalizePcName(pcName);
  if (!normalizedPcName) return null;

  const existing = clientRegistry.get(normalizedPcName);
  if (!existing) return null;
  // Socket lama dapat mengirim disconnect setelah socket pengganti sudah aktif.
  // Jangan sampai event terlambat itu membuat PC yang sehat terlihat offline.
  if (socketId && existing.socket_id && existing.socket_id !== socketId) return null;

  const next = {
    ...existing,
    connected: false,
    socket_id: null,
    last_seen: Date.now(),
  };

  clientRegistry.set(normalizedPcName, next);
  return { ...next, is_online: false };
}

function getClientRegistry(now = Date.now()) {
  return Array.from(clientRegistry.values(), (entry) => ({
    ...entry,
    is_online: entry.connected && (now - entry.last_seen < ONLINE_TTL_MS),
  })).sort((a, b) => a.pc_name.localeCompare(b.pc_name));
}

function getOnlineClientMap(now = Date.now()) {
  const map = new Map();
  for (const entry of getClientRegistry(now)) {
    if (entry.is_online) {
      map.set(entry.pc_name, entry);
    }
  }
  return map;
}

module.exports = {
  ONLINE_TTL_MS,
  normalizePcName,
  normalizeMac,
  upsertClient,
  markClientDisconnected,
  getClientRegistry,
  getOnlineClientMap,
};
