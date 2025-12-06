const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const ScreenTracker = require('./tracker');

let mainWindow;
let tray;
let tracker;
let isShuttingDown = false;

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
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        frame: false,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');

    // Open DevTools to see errors
    // mainWindow.webContents.openDevTools();

    createTray();

    tracker = new ScreenTracker();
    tracker.start();

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