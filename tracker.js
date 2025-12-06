const activeWin = require('active-win');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

class ScreenTracker {
  constructor() {
    this.activities = [];
    this.currentActivity = null;
    this.lastCheck = Date.now();
    this.checkInterval = 5000; // Check every 5 seconds
    this.intervalId = null;
    
    // Local file storage
    this.dataFile = path.join(__dirname, 'activities-data.json');
    
    // MongoDB
    this.mongoClient = null;
    this.db = null;
    
    // Load from local file on startup
    this.loadFromFile();
  }

  loadFromFile() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = fs.readFileSync(this.dataFile, 'utf8');
        this.activities = JSON.parse(data);
        console.log(`📂 Loaded ${this.activities.length} activities from local file`);
      } else {
        console.log('📂 No local data file found - starting fresh');
      }
    } catch (error) {
      console.error('❌ Error loading from file:', error.message);
      this.activities = [];
    }
  }

  // Method to update activities from renderer (for deletions/edits)
  saveActivities(newActivities) {
    this.activities = newActivities;
    this.saveToFile();
  }

  saveToFile() {
    try {
      // Keep only last 30 days of data
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentActivities = this.activities.filter(a => 
        new Date(a.startTime) >= thirtyDaysAgo
      );
      
      fs.writeFileSync(this.dataFile, JSON.stringify(recentActivities, null, 2), 'utf8');
      console.log(`💾 Saved ${recentActivities.length} activities to local file`);
    } catch (error) {
      console.error('❌ Error saving to file:', error.message);
    }
  }

  async connectMongoDB(uri, dbName) {
    try {
      if (this.mongoClient) {
        await this.mongoClient.close();
      }
      
      this.mongoClient = new MongoClient(uri);
      await this.mongoClient.connect();
      this.db = this.mongoClient.db(dbName);
      console.log('✅ Connected to MongoDB:', dbName);
      
      // Load existing activities from last 7 days
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const existing = await this.db.collection('activities')
        .find({ 
          startTime: { $gte: weekAgo.toISOString() }
        })
        .sort({ startTime: -1 })
        .limit(500)
        .toArray();
      
      // Merge with local activities (avoid duplicates)
      existing.forEach(mongoActivity => {
        if (!this.activities.find(a => a.id === mongoActivity.id)) {
          this.activities.push(mongoActivity);
        }
      });
      
      console.log(`📊 Total activities: ${this.activities.length} (merged from MongoDB + local)`);
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection error:', error.message);
      console.log('📂 Continuing with local file storage only');
      return false;
    }
  }

  async start() {
    console.log('🚀 Screen tracker started - monitoring active windows...');
    this.intervalId = setInterval(() => this.checkActiveWindow(), this.checkInterval);
    
    // Don't auto-save - let the UI handle saves to prevent overwriting user changes
    // Only save when a new activity is completed
  }

  stop() {
    console.log('🛑 Screen tracker stopped');
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.saveIntervalId) {
      clearInterval(this.saveIntervalId);
    }
    this.saveCurrentActivity();
    this.saveToFile(); // Final save
    
    if (this.mongoClient) {
      this.mongoClient.close();
    }
  }

  async checkActiveWindow() {
    try {
      const window = await activeWin();
      
      if (!window) {
        console.log('⚠️ No active window detected');
        return;
      }

      const appName = window.owner.name;
      const windowTitle = window.title;
      const now = Date.now();
      
      // If same app/window, increment duration
      if (this.currentActivity && 
          this.currentActivity.name === appName && 
          this.currentActivity.windowTitle === windowTitle) {
        const elapsed = Math.floor((now - this.lastCheck) / 1000);
        this.currentActivity.duration += elapsed;
        this.lastCheck = now;
        return;
      }

      // Different app/window detected - save current and start new
      this.saveCurrentActivity();
      
      this.currentActivity = {
        id: Date.now(),
        name: appName,
        windowTitle: windowTitle,
        type: 'unclassified',
        startTime: new Date().toISOString(),
        duration: 0,
        date: new Date().toLocaleDateString(),
        source: 'auto-tracked'
      };
      
      this.lastCheck = now;
      console.log(`👁️ Tracking: ${appName}`);
      
    } catch (error) {
      console.error('❌ Error checking active window:', error.message);
    }
  }

  saveCurrentActivity() {
    if (this.currentActivity && this.currentActivity.duration >= 5) {
      this.currentActivity.endTime = new Date().toISOString();
      
      const saved = {...this.currentActivity};
      
      // Reload from file first to get latest state (including UI deletions)
      this.loadFromFile();
      
      // Add new activity to the reloaded list
      this.activities.unshift(saved);
      
      // Keep only last 1000 activities in memory
      if (this.activities.length > 1000) {
        this.activities = this.activities.slice(0, 1000);
      }
      
      // Save to both file and MongoDB
      this.saveToFile();
      this.saveToMongoDB(saved);
      
      console.log(`💾 Saved: ${saved.name} - ${saved.duration}s (${this.formatTime(saved.duration)})`);
    }
    this.currentActivity = null;
  }

  async saveToMongoDB(activity) {
    if (!this.db) return;
    
    try {
      await this.db.collection('activities').insertOne(activity);
      console.log(`☁️ Synced to MongoDB: ${activity.name}`);
    } catch (error) {
      console.error('❌ Error saving to MongoDB:', error.message);
    }
  }

  addManualActivity(activity) {
    this.activities.unshift(activity);
    this.saveToFile();
    this.saveToMongoDB(activity);
    console.log(`✏️ Manual activity added: ${activity.name}`);
  }

  getActivities() {
    return this.activities;
  }

  getAllActivities() {
    const all = [...this.activities];
    if (this.currentActivity && this.currentActivity.duration > 0) {
      all.unshift({...this.currentActivity});
    }
    return all;
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
}

module.exports = ScreenTracker;