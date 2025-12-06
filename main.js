const { app, BrowserWindow, ipcMain, Tray, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const ScreenTracker = require('./tracker');
const GoogleCalendarService = require('./google-calendar');
const http = require('http');
const url = require('url');

let mainWindow;
let tray;
let tracker;
let googleCalendar;
let isShuttingDown = false;
let localServer;
const SERVER_PORT = 8765;

// Graceful shutdown - sync before exit
async function gracefulShutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log('\n🔄 Syncing data before exit...');
    
    if (tracker) {
        try {
            await tracker.stop();
            console.log('✅ Sync complete!');
        } catch (err) {
            console.error('❌ Error during sync:', err.message);
        }
    }
    
    // Close local server
    if (localServer) {
        localServer.close();
    }
}

// Create a simple HTTP server to serve the app
function startLocalServer() {
    return new Promise((resolve) => {
        localServer = http.createServer((req, res) => {
            const parsedUrl = url.parse(req.url);
            let pathname = parsedUrl.pathname;
            
            // Default to index.html
            if (pathname === '/') {
                pathname = '/index.html';
            }
            
            // Security: prevent directory traversal
            const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
            let filePath = path.join(__dirname, safePath);
            
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
                return;
            }
            
            // Read and serve file
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('500 Internal Server Error');
                    return;
                }
                
                // Set content type based on file extension
                const ext = path.extname(filePath);
                const contentTypes = {
                    '.html': 'text/html',
                    '.js': 'application/javascript',
                    '.css': 'text/css',
                    '.json': 'application/json',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.ico': 'image/x-icon',
                    '.svg': 'image/svg+xml'
                };
                
                res.writeHead(200, { 
                    'Content-Type': contentTypes[ext] || 'text/plain',
                    'Access-Control-Allow-Origin': '*',
                    'Cross-Origin-Opener-Policy': 'unsafe-none',
                    'Cross-Origin-Embedder-Policy': 'unsafe-none'
                });
                res.end(data);
            });
        });
        
        localServer.listen(SERVER_PORT, '127.0.0.1', () => {
            console.log(`✅ Local server running at http://127.0.0.1:${SERVER_PORT}`);
            resolve();
        });
    });
}

async function createWindow() {
    // Start local HTTP server first
    await startLocalServer();
    
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        frame: false,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false // Disable for Firebase auth to work
        }
    });

    // Load from local HTTP server instead of file://
    mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}/index.html`);

    // Open DevTools to see errors (disable in production)
    // mainWindow.webContents.openDevTools();

    // Allow popups for Firebase authentication with proper settings
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Allow Firebase/Google auth popups
        if (url.includes('accounts.google.com') || url.includes('firebase') || url.includes('google')) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 600,
                    height: 700,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        webSecurity: false,
                        partition: 'persist:google-auth'
                    }
                }
            };
        }
        return { action: 'deny' };
    });

    createTray();

    tracker = new ScreenTracker();
    tracker.start();
    
    // Initialize Google Calendar service
    googleCalendar = new GoogleCalendarService();

    // Send tracked activities every 10 seconds
    setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const activities = tracker.getActivities();
            mainWindow.webContents.send('screen-activities', activities);
        }
    }, 10000);

    // X button minimizes to tray instead of closing
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            
            // Show notification that app is still running (only if tray exists)
            if (tray) {
                tray.displayBalloon({
                    title: 'Productivity Tracker',
                    content: 'App minimized to tray. Right-click tray icon to exit.'
                });
            }
        }
    });
}

function createTray() {
    // Check if icon exists - try .ico first (Windows), then .png
    let iconPath = path.join(__dirname, 'icon.ico');
    if (!fs.existsSync(iconPath)) {
        iconPath = path.join(__dirname, 'icon.png');
    }

    if (!fs.existsSync(iconPath)) {
        console.log('⚠️  No icon.ico or icon.png found - skipping system tray.');
        return;
    }

    try {
        tray = new Tray(iconPath);

        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Show App',
                click: () => {
                    mainWindow.show();
                    mainWindow.focus();
                }
            },
            { type: 'separator' },
            {
                label: 'Exit',
                click: async () => {
                    console.log('🚪 Exit clicked from tray');
                    app.isQuitting = true;
                    await gracefulShutdown();
                    app.exit(0);
                }
            }
        ]);

        tray.setContextMenu(contextMenu);
        tray.setToolTip('Productivity Tracker - Running');

        tray.on('click', () => {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        });

        console.log('✅ System tray created');
    } catch (error) {
        console.error('⚠️  Could not create system tray:', error.message);
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle app quit - sync before exit
app.on('before-quit', () => {
    app.isQuitting = true;
});

// IPC Handlers
ipcMain.on('create-activity', (event, activity) => {
    tracker.addManualActivity(activity);
});

// Window control handlers
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.handle('get-activities', async () => {
    return tracker.getAllActivities();
});

ipcMain.handle('set-mongo-config', async (event, config) => {
    if (config.uri) {
        await tracker.connectMongoDB(config.uri, config.database || 'productivity_tracker');
    }
    return { success: true };
});

ipcMain.handle('sync-mongodb', async () => {
    if (tracker && tracker.db) {
        await tracker.syncFromMongoDB();
        return { success: true, count: tracker.activities.length };
    }
    return { success: false, error: 'MongoDB not connected' };
});

ipcMain.handle('save-activities', async (event, activities) => {
    try {
        // Save to JSON file
        const dataPath = path.join(__dirname, 'activities-data.json');
        fs.writeFileSync(dataPath, JSON.stringify(activities, null, 2));
        
        // Also update tracker - this will sync to both file AND MongoDB
        if (tracker && tracker.saveActivities) {
            tracker.saveActivities(activities);
        }
        
        return { success: true };
    } catch (error) {
        console.error('Error saving activities:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-all-data', async () => {
    try {
        if (tracker && tracker.clearAllData) {
            return await tracker.clearAllData();
        }
        return { success: false, error: 'Tracker not initialized' };
    } catch (error) {
        console.error('Error clearing data:', error);
        return { success: false, error: error.message };
    }
});

// Google Calendar handlers
ipcMain.handle('gcal-is-authorized', async () => {
    try {
        if (googleCalendar) {
            return { authorized: googleCalendar.isAuthorized() };
        }
        return { authorized: false };
    } catch (error) {
        console.error('Error checking gcal authorization:', error.message);
        return { authorized: false };
    }
});

ipcMain.handle('gcal-disconnect', async () => {
    if (googleCalendar) {
        return await googleCalendar.disconnect();
    }
    return { success: false, error: 'Google Calendar service not initialized' };
});

ipcMain.handle('gcal-import-today', async () => {
    if (googleCalendar && googleCalendar.isAuthorized()) {
        const activities = await googleCalendar.importTodayEvents();
        return { success: true, activities };
    }
    return { success: false, error: 'Not authorized' };
});

ipcMain.handle('gcal-sync-activities', async (event, activities) => {
    if (googleCalendar && googleCalendar.isAuthorized()) {
        return await googleCalendar.syncActivitiesToCalendar(activities);
    }
    return { success: false, error: 'Not authorized' };
});

// Browser-based OAuth flow for Google Calendar
ipcMain.handle('gcal-open-browser-auth', async () => {
    try {
        const { shell } = require('electron');
        
        // Generate OAuth URL for Google Calendar
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${encodeURIComponent('777177950872-YOUR_CLIENT_ID.apps.googleusercontent.com')}&` +
            `redirect_uri=${encodeURIComponent('http://127.0.0.1:8765/oauth-callback')}&` +
            `response_type=token&` +
            `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar')}`;
        
        // Open in system browser
        await shell.openExternal(authUrl);
        
        // For now, tell user to copy the token manually
        // In production, you'd set up a callback server to catch the redirect
        return { 
            success: false, 
            error: 'Please use Firebase authentication from the popup instead. Browser OAuth requires additional setup.' 
        };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Firebase Google Calendar token handler
ipcMain.handle('gcal-set-firebase-token', async (event, token) => {
    if (googleCalendar) {
        const result = await googleCalendar.setAccessToken(token);
        if (result.success) {
            // Start auto-sync
            googleCalendar.startAutoSync((newActivities) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('gcal-imported-events', newActivities);
                }
            });
        }
        return result;
    }
    return { success: false, error: 'Google Calendar service not initialized' };
});