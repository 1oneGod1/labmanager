/**
 * /api/client-cmd - Remote power control
 */
const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/requireAdmin');
const { requireDevice } = require('../middleware/requireClient');
const { upsertClient, getClientRegistry } = require('../services/clientRegistryService');

let currentCmd = { cmd: 'none', permanent: false, set_at: null };
let cmdAutoResetTimer = null;

function setCmd(cmd, permanent = false) {
  currentCmd = { cmd, permanent, set_at: Date.now() };
  if (cmdAutoResetTimer) clearTimeout(cmdAutoResetTimer);
  if (cmd !== 'none') {
    cmdAutoResetTimer = setTimeout(() => {
      currentCmd = { cmd: 'none', permanent: false, set_at: null };
    }, 60000);
  }
}

// Admin: set command
router.post('/', requireAdmin, (req, res) => {
  const { cmd, permanent } = req.body;
  if (!['kill', 'enable', 'none'].includes(cmd)) {
    return res.status(400).json({ success: false, message: 'cmd tidak valid.' });
  }
  setCmd(cmd, !!permanent);
  return res.json({ success: true, cmd, permanent: !!permanent });
});

// Client: poll current command
router.get('/current', requireDevice, (_req, res) => {
  return res.json({
    success: true,
    cmd: currentCmd.cmd,
    permanent: currentCmd.permanent,
  });
});

// Client: register MAC
router.post('/register-mac', requireDevice, (req, res) => {
  const { mac, ip, student_name, power_state, session_state } = req.body;
  const pc_name = req.actor.pc_name;
  if (!pc_name || !mac) {
    return res.status(400).json({ success: false, message: 'pc_name dan mac wajib.' });
  }
  upsertClient({
    pc_name,
    mac,
    ip: ip || null,
    student_name: student_name || null,
    source: 'http-heartbeat',
    power_state: power_state || 'awake',
    session_state,
  });
  return res.json({ success: true });
});

// Admin: list MAC entries
router.get('/macs', requireAdmin, (_req, res) => {
  return res.json({
    success: true,
    data: getClientRegistry().filter((entry) => entry.mac),
  });
});

module.exports = router;
