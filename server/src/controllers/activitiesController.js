const firebaseService = require('../services/firebaseService');

/**
 * Activities Controller
 * Handle activity monitoring data from clients (Firebase version)
 */

// POST /api/activities - Receive activity data from client
exports.createActivity = async (req, res) => {
  try {
    const activity = { ...req.body };
    if (req.actor?.role === 'client') {
      activity.pc_name = req.actor.pc_name;
      if (activity.session_id) {
        const session = await firebaseService.sessions.getById(activity.session_id);
        const ownsSession = session && (session.device_id
          ? session.device_id === req.actor.device_id
          : [session.pc_name, session.actual_pc_name].some((name) => String(name || '').toUpperCase() === req.actor.pc_name));
        if (!ownsSession || session.status !== 'active') {
          return res.status(403).json({ success: false, message: 'Sesi activity bukan milik perangkat ini.' });
        }
      }
    }
    if (!activity.pc_name || !activity.activity_type) {
      return res.status(400).json({ success: false, message: 'pc_name dan activity_type wajib diisi.' });
    }
    await firebaseService.activities.create(activity);
    res.json({ success: true, message: 'Activity logged' });
  } catch (error) {
    console.error('[API] Error logging activity:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
};

// GET /api/activities - Get activity logs (admin only)
exports.getActivities = async (req, res) => {
  try {
    const { pc_name, student_id, session_id, limit = 100, offset = 0 } = req.query;
    const activities = await firebaseService.activities.getActivities({ pc_name, student_id, session_id, limit, offset });
    res.json({ success: true, activities });
  } catch (error) {
    console.error('[API] Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

// GET /api/activities/summary - Get activity summary per student
exports.getActivitySummary = async (req, res) => {
  try {
    // For Firebase, we compute summary from activity_logs
    const stats = await firebaseService.activities.getStats({});
    res.json({ success: true, summary: stats });
  } catch (error) {
    console.error('[API] Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
};

// GET /api/activities/session/:sessionId - Get activities for specific session
exports.getSessionActivities = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const rows = await firebaseService.activities.getBySession(sessionId);

    // Group by activity type
    const grouped = {
      browser_urls: rows.filter(r => r.activity_type === 'browser_url'),
      window_changes: rows.filter(r => r.activity_type === 'window_change'),
      app_lists: rows.filter(r => r.activity_type === 'app_list'),
    };

    res.json({ success: true, activities: rows, grouped });
  } catch (error) {
    console.error('[API] Error fetching session activities:', error);
    res.status(500).json({ error: 'Failed to fetch session activities' });
  }
};

// GET /api/activities/student/:studentId - Get activities for specific student
exports.getStudentActivities = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { limit = 100, offset = 0 } = req.query;
    const activities = await firebaseService.activities.getByStudent(studentId, { limit, offset });
    res.json({ success: true, activities });
  } catch (error) {
    console.error('[API] Error fetching student activities:', error);
    res.status(500).json({ error: 'Failed to fetch student activities' });
  }
};

// GET /api/activities/stats - Get statistics
exports.getActivityStats = async (req, res) => {
  try {
    const { student_id, date_from, date_to } = req.query;
    const stats = await firebaseService.activities.getStats({ student_id, date_from, date_to });
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[API] Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

// DELETE /api/activities/cleanup - Manual cleanup old activities
exports.cleanupOldActivities = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const deletedCount = await firebaseService.activities.cleanup(days);

    res.json({ 
      success: true, 
      message: `Deleted ${deletedCount} old activity records`,
      deleted_count: deletedCount,
    });
  } catch (error) {
    console.error('[API] Error cleaning up activities:', error);
    res.status(500).json({ error: 'Failed to cleanup activities' });
  }
};

// GET /api/activities/top-sites - Get most visited sites
exports.getTopSites = async (req, res) => {
  try {
    const { student_id, limit = 10, date_from, date_to } = req.query;
    const topSites = await firebaseService.activities.getTopSites({ student_id, limit, date_from, date_to });
    res.json({ success: true, top_sites: topSites });
  } catch (error) {
    console.error('[API] Error fetching top sites:', error);
    res.status(500).json({ error: 'Failed to fetch top sites' });
  }
};

// GET /api/activities/top-apps - Get most used applications
exports.getTopApps = async (req, res) => {
  try {
    const { student_id, limit = 10, date_from, date_to } = req.query;
    const topApps = await firebaseService.activities.getTopApps({ student_id, limit, date_from, date_to });
    res.json({ success: true, top_apps: topApps });
  } catch (error) {
    console.error('[API] Error fetching top apps:', error);
    res.status(500).json({ error: 'Failed to fetch top apps' });
  }
};

// GET /api/activities/timeline - Get activity counts for the report chart
exports.getActivityTimeline = async (req, res) => {
  try {
    const { date_from, date_to, bucket_count = 7 } = req.query;
    const timeline = await firebaseService.activities.getTimeline({ date_from, date_to, bucket_count });
    res.json({ success: true, timeline });
  } catch (error) {
    console.error('[API] Error fetching activity timeline:', error);
    res.status(500).json({ error: 'Failed to fetch activity timeline' });
  }
};
