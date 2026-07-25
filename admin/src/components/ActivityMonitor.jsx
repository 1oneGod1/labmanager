import React, { useState, useEffect } from 'react';
import { adminFetch } from '../apiConfig.js';

const fetch = adminFetch;

export default function ActivityMonitor({ socket, serverUrl }) {
  const [activities, setActivities] = useState([]);
  const [summary, setSummary] = useState([]);
  const [filter, setFilter] = useState('all'); // all, browser_url, window_change, app_list
  const [selectedStudent, setSelectedStudent] = useState(null);

  useEffect(() => {
    if (!socket) return;

    // Listen for new activities from Socket.IO
    socket.on('activity:new', (activity) => {
      setActivities(prev => [activity, ...prev.slice(0, 99)]);
    });

    // Fetch initial summary
    fetchSummary();

    // Refresh summary every 30 seconds
    const interval = setInterval(fetchSummary, 30000);

    return () => {
      socket.off('activity:new');
      clearInterval(interval);
    };
  }, [socket]);

  const fetchSummary = async () => {
    try {
      const res = await fetch(`${serverUrl}/api/activities/summary`);
      const data = await res.json();
      if (data.success) {
        setSummary(data.summary);
      }
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  };

  const fetchStudentActivities = async (studentId) => {
    try {
      const res = await fetch(`${serverUrl}/api/activities/student/${studentId}?limit=50`);
      const data = await res.json();
      if (data.success) {
        setActivities(data.activities);
        setSelectedStudent(studentId);
      }
    } catch (err) {
      console.error('Failed to fetch student activities:', err);
    }
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'browser_url': return '🌐';
      case 'window_change': return '💻';
      case 'app_list': return '📋';
      default: return '📌';
    }
  };

  const getActivityColor = (type) => {
    switch (type) {
      case 'browser_url': return 'bg-blue-50 border-blue-200';
      case 'window_change': return 'bg-green-50 border-green-200';
      case 'app_list': return 'bg-purple-50 border-purple-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const filteredActivities = filter === 'all' 
    ? activities 
    : activities.filter(a => a.activity_type === filter);

  return (
    <div className="activity-monitor p-6 bg-white rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">🔴 Live Activity Feed</h2>
        
        {/* Filter buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              filter === 'all' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('browser_url')}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              filter === 'browser_url' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            🌐 Browser
          </button>
          <button
            onClick={() => setFilter('window_change')}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              filter === 'window_change' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            💻 Apps
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed - Left side */}
        <div className="lg:col-span-2">
          <div className="activity-list space-y-2 max-h-[600px] overflow-y-auto pr-2">
            {filteredActivities.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg">No activities yet</p>
                <p className="text-sm">Waiting for students to connect...</p>
              </div>
            )}
            
            {filteredActivities.map((activity, idx) => (
              <div 
                key={idx} 
                className={`activity-item p-4 rounded-lg border-2 transition hover:shadow-md ${getActivityColor(activity.activity_type)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{getActivityIcon(activity.activity_type)}</span>
                      <span className="font-semibold text-sm text-gray-700">
                        {activity.pc_name}
                      </span>
                      <span className="text-gray-400">|</span>
                      <span className="text-sm text-gray-600">
                        {activity.student_name || 'Guest'}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-700 mt-1 ml-7">
                      {activity.activity_type === 'browser_url' && (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-blue-600">🌐 Browsing:</span>
                            <span className="font-mono text-xs bg-white px-2 py-1 rounded border">
                              {activity.url_domain || activity.url}
                            </span>
                          </div>
                          {activity.page_title && (
                            <div className="text-xs text-gray-500 mt-1 ml-6">
                              {activity.page_title}
                            </div>
                          )}
                          {activity.browser_name && (
                            <div className="text-xs text-gray-400 mt-1 ml-6">
                              via {activity.browser_name}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {activity.activity_type === 'window_change' && (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-green-600">💻 Using:</span>
                            <span className="font-semibold">{activity.process_name}</span>
                          </div>
                          {activity.window_title && (
                            <div className="text-xs text-gray-500 mt-1 ml-6 truncate">
                              {activity.window_title}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {activity.activity_type === 'app_list' && (
                        <div>
                          <span className="font-medium text-purple-600">📋 Applications:</span>
                          <span className="ml-2">
                            {JSON.parse(activity.running_apps || '[]').length} running
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-xs text-gray-400 whitespace-nowrap ml-4">
                    {new Date(activity.activity_at || activity.received_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary Sidebar - Right side */}
        <div className="lg:col-span-1">
          <h3 className="text-lg font-semibold mb-3 text-gray-700">📊 Activity Summary</h3>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {summary.map((item, idx) => (
              <div 
                key={idx} 
                className="p-4 bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition cursor-pointer"
                onClick={() => fetchStudentActivities(item.student_id)}
              >
                <div className="font-semibold text-gray-800">{item.student_name}</div>
                <div className="text-xs text-gray-500 mb-2">{item.pc_name}</div>
                
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">✅ Productive:</span>
                    <span className="font-semibold text-green-600">{item.productive_count || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">⚠️ Unproductive:</span>
                    <span className="font-semibold text-orange-600">{item.unproductive_count || 0}</span>
                  </div>
                  <div className="flex justify-between items-center border-t pt-1 mt-1">
                    <span className="text-gray-600">📊 Total:</span>
                    <span className="font-bold text-blue-600">{item.activity_count || 0}</span>
                  </div>
                  {item.last_activity && (
                    <div className="text-xs text-gray-400 mt-2">
                      Last: {new Date(item.last_activity).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {summary.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">No activity summary yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected student indicator */}
      {selectedStudent && (
        <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
          <p className="text-sm text-blue-800">
            <strong>Filtered:</strong> Showing activities for student ID {selectedStudent}
            <button 
              onClick={() => {
                setSelectedStudent(null);
                setActivities([]);
              }}
              className="ml-3 text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Clear filter
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
