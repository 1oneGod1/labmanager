const express = require('express');
const router  = express.Router();
const { login, logout, forceLogout, checkStatus, deviceRegister } = require('../controllers/authController');
const { requireAdmin } = require('../middleware/requireAdmin');
const { requireDevice } = require('../middleware/requireClient');

router.post('/login',           requireDevice, login);
router.post('/logout',          requireDevice, logout);
router.post('/force-logout',    requireAdmin, forceLogout);   // memerlukan admin auth
router.get('/device-status',    requireDevice, (req, res) => res.json({ success: true, data: req.actor }));
router.get('/status/:nis',      requireDevice, checkStatus);   // cek real-time status login siswa
router.post('/device-register', deviceRegister);  // client electron meminta token device

module.exports = router;
