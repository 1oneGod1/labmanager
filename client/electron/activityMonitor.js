/**
 * Activity Monitoring Module
 * 
 * Tracks student activities including:
 * - Active window changes
 * - Browser URLs
 * - Running applications
 * 
 * @module activityMonitor
 */

const { execSync } = require('child_process');
const log = require('electron-log');

class ActivityMonitor {
  constructor() {
    this.currentWindow = null;
    this.monitoringActive = false;
    this.pollInterval = null;
    this.appListInterval = null;
    
    // Configuration
    this.config = {
      windowPollMs: 3000,      // Check active window every 3 seconds
      appListPollMs: 30000,    // Get app list every 30 seconds
      enableUrlTracking: true, // Track browser URLs
      enableAppList: true,     // Track running apps
    };
    
    // Callbacks
    this.onActivityCallback = null;
    
    // State
    this.studentInfo = {
      pc_name: null,
      student_id: null,
      student_name: null,
      session_id: null,
    };
    
    // Last activity timestamp to track duration
    this.lastActivityTime = null;
  }

  /**
   * Set student info for activity logging
   */
  setStudentInfo(info) {
    this.studentInfo = {
      pc_name: info.pc_name || null,
      student_id: info.student_id || null,
      student_name: info.student_name || null,
      session_id: info.session_id || null,
    };
  }

  /**
   * Set callback for activity events
   */
  onActivity(callback) {
    this.onActivityCallback = callback;
  }

  /**
   * Start monitoring
   */
  async start() {
    if (this.monitoringActive) {
      log.warn('[ACTIVITY] Monitoring already active');
      return;
    }

    this.monitoringActive = true;
    log.info('[ACTIVITY] Starting activity monitoring');

    // Start window monitoring
    this.pollInterval = setInterval(() => {
      this.checkActiveWindow();
    }, this.config.windowPollMs);

    // Start app list monitoring
    if (this.config.enableAppList) {
      this.appListInterval = setInterval(() => {
        this.collectAppList();
      }, this.config.appListPollMs);
      
      // Get initial app list
      setTimeout(() => this.collectAppList(), 2000);
    }

    // Get initial active window
    this.checkActiveWindow();
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this.monitoringActive) return;

    this.monitoringActive = false;
    log.info('[ACTIVITY] Stopping activity monitoring');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.appListInterval) {
      clearInterval(this.appListInterval);
      this.appListInterval = null;
    }

    this.currentWindow = null;
    this.lastActivityTime = null;
  }

  /**
   * Get active window info using PowerShell (no native module needed)
   */
  getActiveWindowPS() {
    try {
      const psCommand = `Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@ -ErrorAction SilentlyContinue;
$h = [WinAPI]::GetForegroundWindow();
$sb = New-Object Text.StringBuilder 512;
[void][WinAPI]::GetWindowText($h, $sb, 512);
$pid2 = 0; [void][WinAPI]::GetWindowThreadProcessId($h, [ref]$pid2);
$p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue;
@{title=$sb.ToString();name=if($p){$p.Name}else{''};path=if($p){$p.Path}else{''}} | ConvertTo-Json`;

      const output = execSync(
        `powershell -NoProfile -Command "${psCommand.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      );

      const data = JSON.parse(output);
      if (!data || !data.title) return null;

      return {
        title: data.title,
        owner: {
          name: data.name || '',
          path: data.path || '',
        }
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Check active window and track changes
   */
  async checkActiveWindow() {
    if (!this.monitoringActive) return;

    try {
      const window = this.getActiveWindowPS();
      
      if (!window || !window.owner) {
        // No active window (desktop/lock screen)
        return;
      }

      // Check if window has changed
      if (this.hasWindowChanged(window)) {
        const duration = this.calculateDuration();
        this.lastActivityTime = Date.now();
        this.currentWindow = window;
        
        this.onWindowChange(window, duration);
      }
    } catch (err) {
      // Silently handle errors (e.g., permission issues)
      if (err.message && !err.message.includes('ENOENT')) {
        log.warn('[ACTIVITY] Error checking active window:', err.message);
      }
    }
  }

  /**
   * Calculate duration since last activity (in seconds)
   */
  calculateDuration() {
    if (!this.lastActivityTime) return 0;
    return Math.round((Date.now() - this.lastActivityTime) / 1000);
  }

  /**
   * Check if window has changed
   */
  hasWindowChanged(newWindow) {
    if (!this.currentWindow) return true;
    
    // Consider window changed if title or process changed
    return (
      this.currentWindow.title !== newWindow.title ||
      this.currentWindow.owner.name !== newWindow.owner.name
    );
  }

  /**
   * Handle window change event
   */
  onWindowChange(window, duration) {
    const activity = {
      ...this.studentInfo,
      activity_type: 'window_change',
      window_title: this.sanitizeString(window.title, 500),
      process_name: this.sanitizeString(window.owner.name, 200),
      process_path: this.sanitizeString(window.owner.path, 500),
      duration_seconds: duration,
      activity_at: new Date().toISOString(),
    };

    // Check if this is a browser and try to extract URL
    if (this.config.enableUrlTracking && this.isBrowser(window.owner.name)) {
      const urlData = this.extractUrlFromWindow(window);
      
      if (urlData.url) {
        activity.activity_type = 'browser_url';
        activity.browser_name = this.getBrowserName(window.owner.name);
        activity.url = urlData.url;
        activity.url_domain = urlData.domain;
        activity.page_title = urlData.pageTitle;
      }
    }

    this.sendActivity(activity);
  }

  /**
   * Collect list of running applications
   */
  collectAppList() {
    if (!this.monitoringActive || !this.config.enableAppList) return;

    try {
      const apps = this.getRunningApps();
      
      if (apps && apps.length > 0) {
        const activity = {
          ...this.studentInfo,
          activity_type: 'app_list',
          running_apps: JSON.stringify(apps),
          activity_at: new Date().toISOString(),
        };

        this.sendActivity(activity);
      }
    } catch (err) {
      log.warn('[ACTIVITY] Error collecting app list:', err.message);
    }
  }

  /**
   * Get list of running applications with windows
   */
  getRunningApps() {
    try {
      // PowerShell command to get processes with windows
      const psCommand = 'Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object Name, MainWindowTitle, Id | ConvertTo-Json';
      
      const output = execSync(
        `powershell -NoProfile -Command "${psCommand}"`,
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      );

      const processes = JSON.parse(output);
      
      // Handle single process (not array)
      const processList = Array.isArray(processes) ? processes : [processes];
      
      // Filter and clean
      return processList
        .filter(p => p && p.MainWindowTitle && p.MainWindowTitle.trim())
        .filter(p => !this.isSystemProcess(p.Name))
        .map(p => ({
          name: this.sanitizeString(p.Name, 200),
          window_title: this.sanitizeString(p.MainWindowTitle, 500),
          pid: p.Id
        }))
        .slice(0, 50); // Limit to 50 apps max
    } catch (err) {
      log.warn('[ACTIVITY] Failed to get running apps:', err.message);
      return [];
    }
  }

  /**
   * Check if process is a system process (should be filtered out)
   */
  isSystemProcess(processName) {
    const systemProcesses = [
      'ApplicationFrameHost',
      'ShellExperienceHost',
      'SystemSettings',
      'TextInputHost',
      'SearchHost',
      'StartMenuExperienceHost',
      'RuntimeBroker',
      'explorer', // Windows Explorer
    ];
    
    const lower = processName.toLowerCase();
    return systemProcesses.some(sp => lower.includes(sp.toLowerCase()));
  }

  /**
   * Check if process is a browser
   */
  isBrowser(processName) {
    const browsers = [
      'chrome',
      'msedge',
      'firefox',
      'brave',
      'opera',
      'vivaldi',
      'iexplore',
      'MicrosoftEdge',
    ];
    
    const lower = processName.toLowerCase();
    return browsers.some(b => lower.includes(b.toLowerCase()));
  }

  /**
   * Get browser name from process name
   */
  getBrowserName(processName) {
    const lower = processName.toLowerCase();
    
    if (lower.includes('chrome')) return 'Google Chrome';
    if (lower.includes('msedge') || lower.includes('edge')) return 'Microsoft Edge';
    if (lower.includes('firefox')) return 'Mozilla Firefox';
    if (lower.includes('brave')) return 'Brave';
    if (lower.includes('opera')) return 'Opera';
    if (lower.includes('vivaldi')) return 'Vivaldi';
    if (lower.includes('iexplore')) return 'Internet Explorer';
    
    return processName;
  }

  /**
   * Extract URL from browser window
   */
  extractUrlFromWindow(window) {
    const result = {
      url: null,
      domain: null,
      pageTitle: null,
    };

    if (!window || !window.title) return result;

    const title = window.title;

    // Try multiple patterns for URL extraction
    
    // Pattern 1: Direct URL in title (some browsers show full URL)
    const urlPattern = /(https?:\/\/[^\s]+)/i;
    const urlMatch = title.match(urlPattern);
    
    if (urlMatch) {
      result.url = this.sanitizeString(urlMatch[1], 2000);
      try {
        const urlObj = new URL(result.url);
        result.domain = urlObj.hostname;
      } catch {}
      return result;
    }

    // Pattern 2: Title with separator (e.g., "Page Title - Google Chrome")
    // Try to extract domain from common patterns
    const domainPatterns = [
      /^(.+?)\s*[-–—|]\s*(.+?)(?:\s*[-–—|]\s*[^-–—|]+)?$/,  // "Title - Domain - Browser"
      /^(.+?)\s*\|\s*(.+?)$/,                                 // "Title | Domain"
    ];

    for (const pattern of domainPatterns) {
      const match = title.match(pattern);
      if (match && match[2]) {
        const possibleDomain = match[2].trim();
        
        // Check if it looks like a domain
        if (this.looksLikeDomain(possibleDomain)) {
          result.domain = this.sanitizeString(possibleDomain, 200);
          result.pageTitle = this.sanitizeString(match[1].trim(), 500);
          result.url = `https://${result.domain}`;
          return result;
        }
      }
    }

    // Pattern 3: Common site names in title
    const knownSites = {
      'GitHub': 'github.com',
      'Stack Overflow': 'stackoverflow.com',
      'YouTube': 'youtube.com',
      'Google': 'google.com',
      'Facebook': 'facebook.com',
      'Twitter': 'twitter.com',
      'Instagram': 'instagram.com',
      'LinkedIn': 'linkedin.com',
      'Wikipedia': 'wikipedia.org',
    };

    for (const [siteName, domain] of Object.entries(knownSites)) {
      if (title.includes(siteName)) {
        result.domain = domain;
        result.pageTitle = title;
        result.url = `https://${domain}`;
        return result;
      }
    }

    return result;
  }

  /**
   * Check if string looks like a domain name
   */
  looksLikeDomain(str) {
    // Simple heuristic: contains dot and no spaces, not too long
    return (
      str.includes('.') &&
      !str.includes(' ') &&
      str.length < 100 &&
      !/[^\w.-]/.test(str) // Only word chars, dots, hyphens
    );
  }

  /**
   * Sanitize string for database storage
   */
  sanitizeString(str, maxLength) {
    if (!str) return null;
    
    // Remove null characters and trim
    let cleaned = String(str).replace(/\0/g, '').trim();
    
    // Truncate if too long
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength - 3) + '...';
    }
    
    return cleaned || null;
  }

  /**
   * Send activity to callback (will be sent to server)
   */
  sendActivity(activity) {
    if (!this.monitoringActive) return;
    
    // Log activity (debug)
    log.info(`[ACTIVITY] ${activity.activity_type}: ${activity.window_title || activity.process_name || 'app_list'}`);
    
    // Call callback if set
    if (this.onActivityCallback && typeof this.onActivityCallback === 'function') {
      try {
        this.onActivityCallback(activity);
      } catch (err) {
        log.error('[ACTIVITY] Error in activity callback:', err);
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Restart monitoring with new config
    if (this.monitoringActive) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      active: this.monitoringActive,
      currentWindow: this.currentWindow ? {
        title: this.currentWindow.title,
        process: this.currentWindow.owner.name,
      } : null,
      studentInfo: this.studentInfo,
      config: this.config,
    };
  }
}

module.exports = ActivityMonitor;
