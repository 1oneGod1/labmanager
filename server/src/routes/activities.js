const express = require('express');
const router = express.Router();
const activitiesController = require('../controllers/activitiesController');
const { requireAdmin } = require('../middleware/requireAdmin');
const { requireClient } = require('../middleware/requireClient');

/**
 * Activity Monitoring Routes
 */

// Create activity log — butuh client token (atau admin)
router.post('/', requireClient, activitiesController.createActivity);

// Semua endpoint GET & DELETE memerlukan admin authentication
router.get('/',                    requireAdmin, activitiesController.getActivities);
router.get('/summary',             requireAdmin, activitiesController.getActivitySummary);
router.get('/timeline',            requireAdmin, activitiesController.getActivityTimeline);
router.get('/session/:sessionId',  requireAdmin, activitiesController.getSessionActivities);
router.get('/student/:studentId',  requireAdmin, activitiesController.getStudentActivities);
router.get('/stats',               requireAdmin, activitiesController.getActivityStats);
router.get('/top-sites',           requireAdmin, activitiesController.getTopSites);
router.get('/top-apps',            requireAdmin, activitiesController.getTopApps);
router.delete('/cleanup',          requireAdmin, activitiesController.cleanupOldActivities);

module.exports = router;
