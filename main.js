const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const ScreenTracker = require('./tracker');

let mainWindow;
let tray;
let tracker;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');

    // Open DevTools to see errors
    mainWindow.webContents.openDevTools();

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

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    // Check if icon exists, otherwise skip tray creation
    const iconPath = path.join(__dirname, 'icon.png');

    if (!fs.existsSync(iconPath)) {
        console.log('⚠️  No icon.png found - skipping system tray. Add icon.png to enable tray.');
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
            {
                label: 'Hide App',
                click: () => mainWindow.hide()
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    app.isQuitting = true;
                    app.quit();
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

app.on('before-quit', () => {
    app.isQuitting = true;
    if (tracker) {
        tracker.stop();
    }
});

// IPC Handlers
ipcMain.on('create-activity', (event, activity) => {
    tracker.addManualActivity(activity);
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