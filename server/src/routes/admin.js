const express = require('express');
const router  = express.Router();
const {
  verifyPassword,
  login,
  me,
  logout,
  refreshToken,
  listDeviceClaims,
  revokeDeviceClaim,
  storageStatus,
  createStorageBackup,
  getPairingKey,
} = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/requireAdmin');
const { updateBranding } = require('../controllers/brandingController');

// POST /api/admin/verify-password
router.post('/verify-password', verifyPassword);
router.post('/login', login);
router.get('/me', me);
router.post('/refresh', requireAdmin, refreshToken);
router.post('/logout', requireAdmin, logout);

// Device claim management (admin only)
router.get('/device-claims',           requireAdmin, listDeviceClaims);
router.post('/device-claims/revoke',   requireAdmin, revokeDeviceClaim);
router.get('/storage/status',          requireAdmin, storageStatus);
router.post('/storage/backup',         requireAdmin, createStorageBackup);
router.get('/pairing-key',             requireAdmin, getPairingKey);
router.put('/branding',                requireAdmin, updateBranding);

module.exports = router;
