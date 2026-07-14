const express = require('express');
const { getBranding } = require('../controllers/brandingController');

const router = express.Router();
router.get('/', getBranding);

module.exports = router;
