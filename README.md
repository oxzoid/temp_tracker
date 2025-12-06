# Productivity Tracker

A desktop productivity tracker with automatic screen monitoring, Pomodoro timer, and Google Calendar integration.

## Features

- 📊 **Automatic Activity Tracking** - Monitors active windows and tracks time spent
- 🍅 **Pomodoro Timer** - Built-in Pomodoro timer with customizable intervals
- 📅 **Google Calendar Integration** - Import and sync activities with Google Calendar
- 💾 **MongoDB Support** - Optional cloud storage for your activities
- 📈 **Analytics & Charts** - Visual insights into your productivity patterns
- 🎯 **Activity Classification** - Classify activities as productive, unproductive, or neutral

## Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd temp_tracker
npm install
```

### 2. Firebase Configuration (Required for Google Calendar)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Go to **Project Settings** > **Your apps** > **Web app**
4. Copy your Firebase configuration
5. Copy `firebase-config.example.js` to `firebase-config.js`:
   ```bash
   cp firebase-config.example.js firebase-config.js
   ```
6. Edit `firebase-config.js` and paste your Firebase credentials

7. **Important**: Add authorized domain in Firebase Console:
   - Go to **Authentication** > **Settings** > **Authorized domains**
   - Add: `127.0.0.1` (for local HTTP server)

### 3. Run the App

```bash
npm start
```

## Building for Distribution

Build a standalone executable:

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

The built app will work on any computer without requiring Node.js or npm installation. The local HTTP server is embedded in the app, so Firebase authentication will work properly.

## Optional: MongoDB Setup

1. Create a MongoDB Atlas account or use your own MongoDB server
2. Get your connection string
3. In the app, click **MongoDB** button and enter your credentials
4. Activities will automatically sync to your database

## Optional: Google Calendar Integration

1. Make sure Firebase is configured (see step 2 above)
2. In the app, click **Google Calendar** button
3. Click **Sign in with Google**
4. Authorize the app
5. Your calendar events will auto-sync every 5 minutes

## Security Notes

- `firebase-config.js` is in `.gitignore` - your credentials won't be committed
- The app runs a local HTTP server on `127.0.0.1:8765` for Firebase compatibility
- All data is stored locally in `activities-data.json`
- MongoDB and Google Calendar are optional features

## Troubleshooting

**Firebase auth error**: Make sure you've added `127.0.0.1` to Firebase authorized domains

**App won't start**: Check that port 8765 is not in use by another application

**Google Calendar not syncing**: Verify Firebase authentication is working first

## License

MIT
