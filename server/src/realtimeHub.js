const { Server } = require('socket.io');
const { validateToken } = require('./services/adminSessionService');
const clientTokenService = require('./services/clientTokenService');
const {
  normalizePcName,
  upsertClient,
  markClientDisconnected,
} = require('./services/clientRegistryService');
const {
  upsertScreen,
  removeScreen,
  getActiveScreens,
} = require('./services/screenRelayService');
const firebaseService = require('./services/dataService');
const {
  validateDistributionPayload,
  normalizeFileStatus,
} = require('./services/fileRelayService');
const { normalizeControlSettings } = require('./services/controlPolicyService');

const screenWatchers = new Map();
const SYSTEM_COMMANDS = new Set(['lock', 'sleep', 'restart', 'shutdown']);
const DEEP_FREEZE_ACTIONS = new Set(['status', 'freeze', 'unfreeze']);
const deepFreezeStatusByPc = new Map();

function normalizeDeepFreezeStatusPayload(payload = {}) {
  const state = /^[a-z_]{2,40}$/.test(String(payload.state || ''))
    ? String(payload.state)
    : 'error';
  const action = DEEP_FREEZE_ACTIONS.has(String(payload.action || '').toLowerCase())
    ? String(payload.action).toLowerCase()
    : 'status';
  const commandId = /^freeze_[A-Za-z0-9_-]{8,80}$/.test(String(payload.command_id || ''))
    ? String(payload.command_id)
    : null;
  const boundedNumber = (value) => Math.min(1_000_000, Math.max(0, Number(value) || 0));

  return {
    success: payload.success !== false,
    state,
    action,
    provider: ['uwf', 'faronics', 'none'].includes(String(payload.provider || ''))
      ? String(payload.provider)
      : 'none',
    provider_label: String(payload.provider_label || '').replace(/[\u0000-\u001F]/g, ' ').slice(0, 120),
    credential_configured: payload.credential_configured === true,
    requires_provider_password: payload.requires_provider_password === true,
    command_id: commandId,
    supported: payload.supported === true,
    feature_installed: payload.feature_installed === true,
    provider_ready: payload.provider_ready === true,
    is_admin: payload.is_admin === true,
    can_configure: payload.can_configure === true,
    current_enabled: payload.current_enabled === true,
    next_enabled: payload.next_enabled === true,
    current_protected: payload.current_protected === true,
    next_protected: payload.next_protected === true,
    current_frozen: payload.current_frozen === true,
    next_frozen: payload.next_frozen === true,
    restart_required: payload.restart_required === true,
    requires_admin: payload.requires_admin === true,
    overlay_consumption_mb: boundedNumber(payload.overlay_consumption_mb),
    overlay_available_mb: boundedNumber(payload.overlay_available_mb),
    product_name: String(payload.product_name || '').replace(/[\u0000-\u001F]/g, ' ').slice(0, 160),
    faronics_version: String(payload.faronics_version || '').replace(/[\u0000-\u001F]/g, ' ').slice(0, 120),
    system_drive: /^[A-Za-z]:$/.test(String(payload.system_drive || '')) ? String(payload.system_drive).toUpperCase() : null,
    message: String(payload.message || '').replace(/[\u0000-\u001F]/g, ' ').slice(0, 300),
    technical_error: String(payload.technical_error || '').replace(/[\u0000-\u001F]/g, ' ').slice(0, 500),
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.slice(0, 8).map((value) => String(value).replace(/[\u0000-\u001F]/g, ' ').slice(0, 240))
      : [],
    observed_at: Number(payload.observed_at) || Date.now(),
  };
}


function getClientChannel(socket) {
  return socket.data.channel === 'main' ? 'main' : 'renderer';
}

function emitToClientChannel(io, channel, eventName, payload, target = 'all') {
  const normalizedTarget = target && target !== 'all' ? normalizePcName(target) : null;
  const deliveredPcs = new Set();
  for (const [, clientSocket] of io.sockets.sockets) {
    if (clientSocket.data.role !== 'client') continue;
    if (getClientChannel(clientSocket) !== channel) continue;
    const pcName = normalizePcName(clientSocket.data.claimed_pc_name || clientSocket.data.pc_name);
    if (!pcName || (normalizedTarget && pcName !== normalizedTarget)) continue;
    clientSocket.emit(eventName, payload);
    deliveredPcs.add(pcName);
  }
  return deliveredPcs.size;
}

function getClientRoom(pcName) {
  const normalizedPcName = normalizePcName(pcName);
  return normalizedPcName ? `client:${normalizedPcName}` : null;
}

function updateWatcherCount(pcName, delta) {
  const normalizedPcName = normalizePcName(pcName);
  if (!normalizedPcName || !delta) return;

  const next = (screenWatchers.get(normalizedPcName) || 0) + delta;
  if (next <= 0) {
    screenWatchers.delete(normalizedPcName);
    return;
  }
  screenWatchers.set(normalizedPcName, next);
}

function emitScreenQuality(io, pcName) {
  const normalizedPcName = normalizePcName(pcName);
  const room = getClientRoom(normalizedPcName);
  if (!normalizedPcName || !room) return;

  const watcherCount = screenWatchers.get(normalizedPcName) || 0;
  io.to(room).emit('screen:quality', {
    pc_name: normalizedPcName,
    mode: watcherCount > 0 ? 'focus' : 'overview',
  });
}

function attachRealtimeHub(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Tanpa origin digunakan request same-origin/non-browser yang sah.
        if (!origin) return callback(null, true);
        const ALLOWED = [
          /^labkom:\/\/app$/,
          /^http:\/\/localhost(:\d+)?$/,
          /^http:\/\/127\.0\.0\.1(:\d+)?$/,
          /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
          /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
          /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
        ];
        if (ALLOWED.some(p => p.test(origin))) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    },
    maxHttpBufferSize: 2 * 1024 * 1024,
  });

  io.use((socket, next) => {
    const role = socket.handshake.auth?.role;
    if (role === 'admin') {
      const token = socket.handshake.auth?.token;
      if (!validateToken(token)) {
        return next(new Error('unauthorized'));
      }
      socket.data.role = 'admin';
      return next();
    }

    // Client role: butuh device token yang sudah teregister
    const clientToken = socket.handshake.auth?.client_token;
    const claim = clientTokenService.validateToken(clientToken);
    if (!claim) {
      return next(new Error('unauthorized client — token invalid atau expired'));
    }
    socket.data.role = 'client';
    socket.data.channel = socket.handshake.auth?.channel === 'main' ? 'main' : 'renderer';
    socket.data.device_id = claim.device_id;
    socket.data.claimed_pc_name = claim.pc_name;
    socket.data.pc_name = claim.pc_name;
    return next();
  });

  io.on('connection', (socket) => {
    if (socket.data.role === 'admin') {
      socket.join('admins');
      socket.emit('screens:snapshot', getActiveScreens());
      socket.emit('deep-freeze:snapshot', [...deepFreezeStatusByPc.values()]);

      const setWatchTarget = (nextPcName = null) => {
        const previousPcName = normalizePcName(socket.data.watch_pc_name);
        const normalizedNextPcName = normalizePcName(nextPcName);
        if (previousPcName === normalizedNextPcName) return;

        if (previousPcName) {
          updateWatcherCount(previousPcName, -1);
          emitScreenQuality(io, previousPcName);
        }

        socket.data.watch_pc_name = normalizedNextPcName || null;

        if (normalizedNextPcName) {
          updateWatcherCount(normalizedNextPcName, 1);
          emitScreenQuality(io, normalizedNextPcName);
        }
      };

      socket.on('admin:watch-screen', ({ pc_name } = {}) => {
        setWatchTarget(pc_name || null);
      });

      socket.on('admin:stop-watch-screen', () => {
        setWatchTarget(null);
      });

      // ── Chat: Admin broadcast message to all clients ──────────
      socket.on('admin:broadcast-message', (data, callback) => {
        const { message: msg, timestamp: ts } = data || {};
        if (!msg) return callback?.({ success: false, error: 'Empty message' });

        const payload = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          from: 'Admin',
          message: msg,
          timestamp: ts || new Date().toISOString(),
        };

        const count = emitToClientChannel(io, 'renderer', 'chat:message-from-admin', payload);

        // Save to Firebase (async, don't block)
        saveChatMessage({ ...payload, type: 'admin_broadcast', delivered_to: count }).catch(err => {
          console.error('[CHAT] Failed to save:', err.message);
        });

        callback?.({ success: true, count });
      });

      // File kelas: relay file kecil langsung ke client terautentikasi.
      socket.on('admin:file-distribute', (data, callback) => {
        const validated = validateDistributionPayload(data);
        if (!validated.ok) {
          callback?.({ success: false, error: validated.error });
          return;
        }

        const count = emitToClientChannel(io, 'renderer', 'classroom:file-received', validated.payload);

        callback?.({ success: true, count, distribution_id: validated.payload.id });
      });

      socket.on('admin:file-collection-request', (data = {}, callback) => {
        const id = String(data.id || '').trim();
        const label = String(data.label || '').trim().replace(/[\u0000-\u001F]/g, ' ').slice(0, 120);
        if (!/^collect_[A-Za-z0-9_-]{6,70}$/.test(id) || !label) {
          callback?.({ success: false, error: 'Permintaan pengumpulan tidak valid.' });
          return;
        }
        const payload = { id, label, requested_at: new Date().toISOString() };
        const count = emitToClientChannel(io, 'renderer', 'classroom:file-collection-request', payload);
        callback?.({ success: true, count, collection_id: id });
      });

      socket.on('admin:system-command', (data = {}, callback) => {
        const command = String(data.command || '').toLowerCase();
        const target = data.target && data.target !== 'all' ? normalizePcName(data.target) : 'all';
        if (!SYSTEM_COMMANDS.has(command) || !target) {
          callback?.({ success: false, error: 'Perintah sistem tidak valid.' });
          return;
        }
        const payload = {
          id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          command,
          target,
          requested_at: new Date().toISOString(),
        };
        const count = emitToClientChannel(io, 'main', 'system:command', payload, target);
        callback?.({ success: true, count, command_id: payload.id });
      });

      socket.on('admin:deep-freeze', (data = {}, callback) => {
        const action = String(data.action || '').toLowerCase();
        const target = data.target && data.target !== 'all' ? normalizePcName(data.target) : 'all';
        if (!DEEP_FREEZE_ACTIONS.has(action) || !target) {
          callback?.({ success: false, error: 'Perintah Deep Freeze tidak valid.' });
          return;
        }
        const payload = {
          id: `freeze_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          action,
          target,
          requested_at: new Date().toISOString(),
        };
        const count = emitToClientChannel(io, 'main', 'deep-freeze:command', payload, target);
        callback?.({ success: true, count, command_id: payload.id });
      });

      // ── Admin Screen Share ─────────────────────────────────────
      socket.on('admin:screen-share-start', (_data = {}, callback) => {
        const count = emitToClientChannel(io, 'renderer', 'admin:screen-share-start', {});
        callback?.({ success: true, count });
      });

      socket.on('admin:screen-share-frame', (data = {}) => {
        const image = String(data.image || '');
        if (!image.startsWith('data:image/jpeg;base64,') || image.length > 1_900_000) return;
        emitToClientChannel(io, 'renderer', 'admin:screen-share-frame', { image });
      });

      socket.on('admin:screen-share-stop', (_data = {}, callback) => {
        const count = emitToClientChannel(io, 'renderer', 'admin:screen-share-stop', {});
        callback?.({ success: true, count });
      });

      // ── Attention Mode (Blank Screen) ──────────────────────────
      socket.on('admin:attention-mode', ({ enabled, message, target } = {}, callback) => {
        const payload = {
          enabled: Boolean(enabled),
          message: message || 'Mohon perhatian ke instruktur',
          timestamp: Date.now(),
        };

        const normalizedTarget = target && target !== 'all' ? target : 'all';
        const delivered = emitToClientChannel(
          io, 'renderer', 'attention-mode', payload, normalizedTarget,
        );

        // Notify other admins
        socket.to('admins').emit('attention-mode-status', {
          ...payload,
          target: normalizedTarget,
          admin_id: socket.id,
        });
        callback?.({ success: !payload.enabled || delivered > 0, count: delivered });
      });

      socket.on('disconnect', () => {
        setWatchTarget(null);
      });

      return;
    }

    socket.join('clients');
    socket.join(`clients-${getClientChannel(socket)}`);
    if (getClientChannel(socket) === 'main') {
      firebaseService.control.getAll()
        .then((settings) => socket.emit('control:settings', normalizeControlSettings(settings)))
        .catch((error) => console.error('[CONTROL] Failed to load client policy:', error.message));
    }

    const bindClientRoom = (pcName) => {
      const normalizedPcName = normalizePcName(pcName);
      const previousPcName = normalizePcName(socket.data.pc_name);
      const previousRoom = getClientRoom(previousPcName);
      const nextRoom = getClientRoom(normalizedPcName);

      if (previousRoom && previousRoom !== nextRoom) {
        socket.leave(previousRoom);
      }
      if (nextRoom) {
        socket.join(nextRoom);
        socket.data.pc_name = normalizedPcName;
        emitScreenQuality(io, normalizedPcName);
      }
    };

    function updatePresence(payload = {}, source = 'socket') {
      const entry = upsertClient({
        pc_name: socket.data.claimed_pc_name,
        mac: payload.mac,
        ip: payload.ip,
        student_name: payload.student_name,
        power_state: payload.power_state || (['socket-hello', 'socket-heartbeat'].includes(source) ? 'awake' : undefined),
        session_state: payload.session_state,
        socket_id: socket.id,
        source,
      });

      if (!entry) return null;
      bindClientRoom(entry.pc_name);
      io.to('admins').emit('presence:update', {
        pc_name: entry.pc_name,
        ip: entry.ip || null,
        mac: entry.mac || null,
        student_name: entry.student_name || null,
        is_online: true,
        power_state: entry.power_state,
        session_state: entry.session_state,
        power_state_changed_at: entry.power_state_changed_at,
        last_seen: entry.last_seen,
      });
      return entry;
    }

    bindClientRoom(socket.data.claimed_pc_name);

    socket.on('client:hello', (payload = {}) => {
      if (getClientChannel(socket) !== 'main') return;
      updatePresence(payload, 'socket-hello');
    });

    socket.on('client:heartbeat', (payload = {}) => {
      if (getClientChannel(socket) !== 'main') return;
      updatePresence(payload, 'socket-heartbeat');
    });

    socket.on('client:power-state', (payload = {}) => {
      if (getClientChannel(socket) !== 'main') return;
      updatePresence(payload, 'socket-power-state');
    });

    socket.on('client:screen', (payload = {}) => {
      const pcName = normalizePcName(socket.data.claimed_pc_name);
      if (!pcName || !payload.image) return;

      updatePresence({ ...payload, pc_name: pcName }, 'socket-screen');
      const screen = upsertScreen({
        pc_name: pcName,
        image: payload.image,
        student_name: payload.student_name || null,
      });
      if (screen) {
        io.to('admins').emit('screen:update', screen);
      }
    });

    socket.on('client:screen-stop', (payload = {}) => {
      const pcName = normalizePcName(socket.data.claimed_pc_name);
      if (!pcName) return;
      if (removeScreen(pcName)) {
        io.to('admins').emit('screen:remove', { pc_name: pcName });
      }
      updatePresence({ ...payload, pc_name: pcName, student_name: null }, 'socket-screen-stop');
    });

    // ── Chat: Client reply to admin ────────────────────────────
    socket.on('chat:reply-to-admin', (data = {}, callback) => {
      const pcName = normalizePcName(socket.data.claimed_pc_name || socket.data.pc_name);
      const message = String(data.message || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
        .trim()
        .slice(0, 2_000);
      if (!pcName || !message) {
        callback?.({ success: false, error: 'Pesan kosong atau identitas PC tidak valid.' });
        return;
      }

      const studentName = String(data.student_name || socket.data.student_name || '')
        .replace(/[\u0000-\u001F]/g, ' ')
        .trim()
        .slice(0, 120) || null;
      const payload = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        pc_name: pcName,
        student_name: studentName,
        message,
        timestamp: data.timestamp || new Date().toISOString(),
      };

      const adminCount = io.sockets.adapter.rooms.get('admins')?.size || 0;
      io.to('admins').emit('chat:message-from-client', payload);
      saveChatMessage({ ...payload, type: 'client_reply', delivered_to: adminCount }).catch(err => {
        console.error('[CHAT] Failed to save client reply:', err.message);
      });
      callback?.({ success: true, id: payload.id, admin_count: adminCount });
    });

    // ── Client acknowledgement for attention mode ──────────────
    socket.on('client:attention-ack', (payload = {}) => {
      const pcName = normalizePcName(socket.data.pc_name);
      if (!pcName) return;
      
      io.to('admins').emit('client:attention-ack', {
        pc_name: pcName,
        acknowledged: true,
        timestamp: Date.now(),
      });
    });

    socket.on('client:file-status', (payload = {}) => {
      const pcName = normalizePcName(socket.data.pc_name);
      const distributionId = String(payload.distribution_id || '').trim();
      const status = normalizeFileStatus(payload.status);
      if (!pcName || !status || !/^[A-Za-z0-9_-]{8,80}$/.test(distributionId)) return;

      io.to('admins').emit('client:file-status', {
        pc_name: pcName,
        distribution_id: distributionId,
        status,
        size: Number(payload.size) || 0,
        received_at: Date.now(),
      });
    });

    socket.on('client:file-submission', (payload = {}, callback) => {
      const pcName = normalizePcName(socket.data.pc_name);
      const collectionId = String(payload.collection_id || '').trim();
      if (!pcName || !/^collect_[A-Za-z0-9_-]{6,70}$/.test(collectionId)) {
        callback?.({ success: false, error: 'Identitas pengumpulan tidak valid.' });
        return;
      }

      const validated = validateDistributionPayload({
        id: collectionId,
        name: payload.name,
        type: payload.type,
        size: payload.size,
        data: payload.data,
      });
      if (!validated.ok) {
        callback?.({ success: false, error: validated.error });
        return;
      }

      io.to('admins').emit('client:file-submission', {
        ...validated.payload,
        collection_id: collectionId,
        pc_name: pcName,
        student_name: String(payload.student_name || '').trim().slice(0, 120) || null,
        submitted_at: new Date().toISOString(),
      });
      callback?.({ success: true, collection_id: collectionId });
    });

    socket.on('client:system-command-ack', (payload = {}) => {
      if (getClientChannel(socket) !== 'main') return;
      const pcName = normalizePcName(socket.data.pc_name);
      const command = String(payload.command || '').toLowerCase();
      const commandId = String(payload.command_id || '').trim();
      if (!pcName || !SYSTEM_COMMANDS.has(command) || !/^cmd_[A-Za-z0-9_-]{8,80}$/.test(commandId)) return;
      io.to('admins').emit('client:system-command-ack', {
        pc_name: pcName,
        command,
        command_id: commandId,
        success: payload.success !== false,
        message: String(payload.message || '').slice(0, 240),
        acknowledged_at: Date.now(),
      });
    });
    socket.on('client:deep-freeze-status', (payload = {}) => {
      if (getClientChannel(socket) !== 'main') return;
      const pcName = normalizePcName(socket.data.pc_name);
      if (!pcName) return;

      const status = {
        ...normalizeDeepFreezeStatusPayload(payload),
        pc_name: pcName,
        online: true,
        received_at: Date.now(),
      };
      deepFreezeStatusByPc.set(pcName, status);
      io.to('admins').emit('client:deep-freeze-status', status);
    });


    socket.on('client:policy-status', (payload = {}) => {
      if (getClientChannel(socket) !== 'main') return;
      const pcName = normalizePcName(socket.data.pc_name);
      if (!pcName) return;
      io.to('admins').emit('client:policy-status', {
        pc_name: pcName,
        volume: payload.volume !== false,
        wallpaper: payload.wallpaper !== false,
        web_filter: payload.web_filter !== false,
        message: String(payload.message || '').slice(0, 240),
        applied_at: Date.now(),
      });
    });

    // ── Activity Monitoring ────────────────────────────────────
    socket.on('client:activity', async (activity = {}) => {
      const pcName = normalizePcName(socket.data.pc_name);
      if (!pcName) return;

      // Broadcast to admin dashboard for live feed
      io.to('admins').emit('activity:new', {
        ...activity,
        pc_name: pcName,
        received_at: Date.now(),
      });

      // Save to database (async, don't block)
      saveActivityToDatabase({ ...activity, pc_name: pcName }).catch(err => {
        console.error('[ACTIVITY] Failed to save:', err.message);
      });
    });

    socket.on('disconnect', () => {
      const pcName = normalizePcName(socket.data.pc_name);
      if (!pcName) return;
      if (getClientChannel(socket) !== 'main') return;

      const disconnectedEntry = markClientDisconnected(pcName, socket.id);
      if (!disconnectedEntry) return;
      if (removeScreen(pcName)) {
        io.to('admins').emit('screen:remove', { pc_name: pcName });
      }
      io.to('admins').emit('presence:update', {
        pc_name: pcName,
        is_online: false,
        power_state: disconnectedEntry.power_state || 'awake',
        session_state: disconnectedEntry.session_state || 'login',
        power_state_changed_at: disconnectedEntry.power_state_changed_at || null,
        last_seen: Date.now(),
      });
      const previousFreezeStatus = deepFreezeStatusByPc.get(pcName);
      if (previousFreezeStatus) {
        const offlineStatus = { ...previousFreezeStatus, online: false, received_at: Date.now() };
        deepFreezeStatusByPc.set(pcName, offlineStatus);
        io.to('admins').emit('client:deep-freeze-status', offlineStatus);
      }
    });
  });

  return io;
}

// ── Helper: Save chat message to database (Firebase) ───────────
async function saveChatMessage(messageData) {
  if (firebaseService.chat && firebaseService.chat.create) {
    await firebaseService.chat.create(messageData);
  }
}

// ── Helper: Save activity to database (Firebase) ───────────────
async function saveActivityToDatabase(activity) {
  await firebaseService.activities.create(activity);
}

module.exports = { attachRealtimeHub, normalizeDeepFreezeStatusPayload };
