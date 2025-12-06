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
    // Also sync all changes to MongoDB (including deletions)
    this.syncToMongoDB(newActivities);
    this.syncDeletionsToMongoDB(newActivities.map(a => a.id));
  }

  async syncToMongoDB(activities) {
    if (!this.db) return;
    
    try {
      // For now, upsert each activity (update if exists, insert if not)
      const collection = this.db.collection('activities');
      
      for (const activity of activities) {
        // Remove _id from the update to avoid MongoDB error
        const { _id, ...activityWithoutId } = activity;
        
        await collection.updateOne(
          { id: activity.id },
          { $set: activityWithoutId },
          { upsert: true }
        );
      }
      
      console.log(`☁️ Synced ${activities.length} activities to MongoDB`);
    } catch (error) {
      console.error('❌ Error syncing to MongoDB:', error.message);
    }
  }

  async syncFromMongoDB() {
    if (!this.db) return this.activities;
    
    try {
      // Load last 30 days from MongoDB
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const mongoActivities = await this.db.collection('activities')
        .find({ 
          startTime: { $gte: thirtyDaysAgo.toISOString() }
        })
        .sort({ startTime: -1 })
        .limit(1000)
        .toArray();
      
      // Merge: MongoDB activities take priority for same ID
      const merged = new Map();
      
      // Add local activities first
      this.activities.forEach(a => merged.set(a.id, a));
      
      // MongoDB activities override (they're the "truth" for synced data)
      mongoActivities.forEach(a => merged.set(a.id, a));
      
      this.activities = Array.from(merged.values())
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
      
      console.log(`📊 Synced from MongoDB: ${mongoActivities.length} activities, total: ${this.activities.length}`);
      
      // Save merged data back to local file
      this.saveToFile();
      
      return this.activities;
    } catch (error) {
      console.error('❌ Error syncing from MongoDB:', error.message);
      return this.activities;
    }
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
      
      // Bidirectional sync: merge MongoDB and local, then upload all to MongoDB
      await this.syncFromMongoDB();
      
      // Upload any local-only activities to MongoDB
      await this.syncToMongoDB(this.activities);
      
      console.log(`📊 Bidirectional sync complete: ${this.activities.length} total activities`);
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

  async stop() {
    console.log('🛑 Screen tracker stopping...');
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.saveIntervalId) {
      clearInterval(this.saveIntervalId);
    }
    
    // Save current activity
    this.saveCurrentActivity();
    this.saveToFile();
    
    // Sync to MongoDB before closing
    if (this.db) {
      console.log('☁️ Syncing to MongoDB before exit...');
      await this.syncToMongoDB(this.activities);
      console.log('✅ MongoDB sync complete');
    }
    
    // Close MongoDB connection
    if (this.mongoClient) {
      await this.mongoClient.close();
      console.log('🔌 MongoDB connection closed');
    }
    
    console.log('🛑 Screen tracker stopped');
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

  async deleteFromMongoDB(activityId) {
    if (!this.db) return;
    
    try {
      await this.db.collection('activities').deleteOne({ id: activityId });
      console.log(`🗑️ Deleted from MongoDB: ${activityId}`);
    } catch (error) {
      console.error('❌ Error deleting from MongoDB:', error.message);
    }
  }

  // Sync deletions: find activities in MongoDB that are not in local
  async syncDeletionsToMongoDB(localActivityIds) {
    if (!this.db) return;
    
    try {
      // Get all IDs currently in MongoDB
      const mongoActivities = await this.db.collection('activities')
        .find({}, { projection: { id: 1 } })
        .toArray();
      
      const mongoIds = mongoActivities.map(a => a.id);
      const localIdSet = new Set(localActivityIds);
      
      // Delete from MongoDB any that aren't in local anymore
      for (const mongoId of mongoIds) {
        if (!localIdSet.has(mongoId)) {
          await this.deleteFromMongoDB(mongoId);
        }
      }
    } catch (error) {
      console.error('❌ Error syncing deletions:', error.message);
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

  // Clear all data from local file and MongoDB
  async clearAllData() {
    try {
      // Clear local activities
      this.activities = [];
      
      // Clear local file
      fs.writeFileSync(this.dataFile, JSON.stringify([], null, 2));
      console.log('🗑️ Local data file cleared');
      
      // Clear MongoDB collection
      if (this.db) {
        await this.db.collection('activities').deleteMany({});
        console.log('🗑️ MongoDB collection cleared');
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing data:', error.message);
      return { success: false, error: error.message };
    }
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