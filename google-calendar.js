const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class GoogleCalendarService {
  constructor() {
    this.auth = null;
    this.calendar = null;
    this.autoSyncInterval = null;
    this.accessToken = null;
    
    const userDataPath = app.getPath('userData');
    this.tokenPath = path.join(userDataPath, 'google-token.json');
    
    console.log('📅 Google Calendar token path:', this.tokenPath);
  }

  // Set access token from Firebase
  async setAccessToken(token) {
    try {
      this.accessToken = token;
      
      // Create OAuth2 client with token
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({
        access_token: token
      });
      
      this.auth = oauth2Client;
      this.calendar = google.calendar({ version: 'v3', auth: this.auth });
      
      // Save token
      fs.writeFileSync(this.tokenPath, JSON.stringify({ access_token: token }));
      
      console.log('✅ Google Calendar authorized with Firebase token');
      return { success: true, needsAuth: false };
      
    } catch (error) {
      console.error('❌ Error setting access token:', error.message);
      return { success: false, error: error.message };
    }
  }

  async authorize() {
    try {
      // Check if we have a saved token
      if (fs.existsSync(this.tokenPath)) {
        const savedToken = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
        if (savedToken.access_token) {
          const result = await this.setAccessToken(savedToken.access_token);
          if (result.success) {
            return { success: true, needsAuth: false };
          }
        }
      }

      // Need Firebase authentication
      return { success: false, needsAuth: true };
      
    } catch (error) {
      console.error('❌ Error authorizing Google Calendar:', error.message);
      return { success: false, error: error.message };
    }
  }

  async disconnect() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }
      this.auth = null;
      this.calendar = null;
      this.accessToken = null;
      this.stopAutoSync();
      console.log('🔌 Google Calendar disconnected');
      return { success: true };
    } catch (error) {
      console.error('❌ Error disconnecting:', error.message);
      return { success: false, error: error.message };
    }
  }

  isAuthorized() {
    return this.auth !== null && this.calendar !== null;
  }

  startAutoSync(onNewEvents) {
    if (this.autoSyncInterval) return;
    
    console.log('🔄 Starting Google Calendar auto-sync (every 5 min)');
    
    this.importTodayEvents(onNewEvents);
    
    this.autoSyncInterval = setInterval(() => {
      this.importTodayEvents(onNewEvents);
    }, 5 * 60 * 1000);
  }

  stopAutoSync() {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log('🛑 Stopped Google Calendar auto-sync');
    }
  }

  async importTodayEvents(onNewEvents) {
    if (!this.isAuthorized()) return { success: false, error: 'Not authorized' };

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: today.toISOString(),
        timeMax: tomorrow.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      const activities = [];

      for (const event of events) {
        if (!event.start.dateTime || !event.end.dateTime) continue;

        const startTime = new Date(event.start.dateTime);
        const endTime = new Date(event.end.dateTime);
        const duration = Math.floor((endTime - startTime) / 1000);

        const activity = {
          id: `gcal_${event.id}`,
          name: event.summary || 'Untitled Event',
          type: 'neutral',
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          duration: duration,
          date: startTime.toLocaleDateString(),
          source: 'google-calendar',
          windowTitle: event.description || 'Google Calendar Event',
          gcalEventId: event.id
        };

        activities.push(activity);
      }

      console.log(`📥 Imported ${activities.length} events from Google Calendar`);
      
      if (onNewEvents && activities.length > 0) {
        onNewEvents(activities);
      }

      return { success: true, count: activities.length, activities };
    } catch (error) {
      console.error('❌ Error importing calendar events:', error.message);
      return { success: false, error: error.message };
    }
  }

  async createEvent(activity) {
    if (!this.isAuthorized()) {
      return { success: false, error: 'Not authorized' };
    }

    try {
      if (activity.source === 'google-calendar') {
        return { success: true, skipped: true };
      }

      const event = {
        summary: activity.name,
        description: `${activity.type} activity\n${activity.windowTitle || ''}`,
        start: {
          dateTime: activity.startTime,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: activity.endTime,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        colorId: this.getColorId(activity.type),
      };

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event,
      });

      console.log('📅 Event created:', response.data.htmlLink);
      return { success: true, eventId: response.data.id, link: response.data.htmlLink };
    } catch (error) {
      console.error('❌ Error creating event:', error.message);
      return { success: false, error: error.message };
    }
  }

  async syncActivities(activities) {
    if (!this.isAuthorized()) {
      return { success: false, error: 'Not authorized' };
    }

    try {
      const results = { success: 0, failed: 0, skipped: 0 };
      
      for (const activity of activities) {
        if (!activity.startTime || !activity.endTime) continue;
        
        const result = await this.createEvent(activity);
        if (result.success) {
          if (result.skipped) {
            results.skipped++;
          } else {
            results.success++;
          }
        } else {
          results.failed++;
        }
      }

      console.log(`📅 Synced ${results.success} activities, ${results.failed} failed, ${results.skipped} skipped`);
      return { success: true, results };
    } catch (error) {
      console.error('❌ Error syncing activities:', error.message);
      return { success: false, error: error.message };
    }
  }

  getColorId(type) {
    const colorMap = {
      'productive': '10',
      'unproductive': '11',
      'neutral': '8',
      'untracked': '11'
    };
    return colorMap[type] || '1';
  }
}

module.exports = GoogleCalendarService;