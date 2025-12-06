const activeWin = require('active-win');
const { MongoClient } = require('mongodb');

class ScreenTracker {
    constructor() {
        this.activities = [];
        this.currentActivity = null;
        this.lastCheck = Date.now();
        this.checkInterval = 5000; // Check every 5 seconds
        this.intervalId = null;

        // MongoDB
        this.mongoClient = null;
        this.db = null;
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

            this.activities = existing;
            console.log(`📊 Loaded ${existing.length} activities from MongoDB`);
            return true;
        } catch (error) {
            console.error('❌ MongoDB connection error:', error.message);
            return false;
        }
    }

    async start() {
        console.log('🚀 Screen tracker started - monitoring active windows...');
        this.intervalId = setInterval(() => this.checkActiveWindow(), this.checkInterval);
    }

    stop() {
        console.log('🛑 Screen tracker stopped');
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.saveCurrentActivity();

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

            const saved = { ...this.currentActivity };
            this.activities.unshift(saved);

            // Keep only last 500 activities in memory
            if (this.activities.length > 500) {
                this.activities = this.activities.slice(0, 500);
            }

            // Save to MongoDB
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
        this.saveToMongoDB(activity);
        console.log(`✏️ Manual activity added: ${activity.name}`);
    }

    getActivities() {
        return this.activities;
    }

    getAllActivities() {
        const all = [...this.activities];
        if (this.currentActivity && this.currentActivity.duration > 0) {
            all.unshift({ ...this.currentActivity });
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