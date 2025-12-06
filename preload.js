const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Receive auto-tracked activities from main process
    onScreenActivities: (callback) => {
        ipcRenderer.on('screen-activities', (event, activities) => {
            callback(activities);
        });
    },

    // Send manual activities to main process
    createActivity: (activity) => {
        ipcRenderer.send('create-activity', activity);
    },

    // Get all activities
    getActivities: () => {
        return ipcRenderer.invoke('get-activities');
    },

    // Set MongoDB config
    setMongoConfig: (config) => {
        return ipcRenderer.invoke('set-mongo-config', config);
    },

    // Save activities
    saveActivities: (activities) => {
        return ipcRenderer.invoke('save-activities', activities);
    },

    // Sync with MongoDB
    syncMongoDB: () => {
        return ipcRenderer.invoke('sync-mongodb');
    },

    // Clear all data (local + MongoDB)
    clearAllData: () => {
        return ipcRenderer.invoke('clear-all-data');
    },

    // Window controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // Google Calendar
    gcalAuthorize: () => ipcRenderer.invoke('gcal-authorize'),
    gcalCompleteAuth: (code) => ipcRenderer.invoke('gcal-complete-auth', code),
    gcalDisconnect: () => ipcRenderer.invoke('gcal-disconnect'),
    gcalIsAuthorized: () => ipcRenderer.invoke('gcal-is-authorized'),
    gcalSyncActivities: (activities) => ipcRenderer.invoke('gcal-sync-activities', activities),
    gcalCreateEvent: (activity) => ipcRenderer.invoke('gcal-create-event', activity),
    gcalImportToday: () => ipcRenderer.invoke('gcal-import-today'),
    gcalSetFirebaseToken: (token) => ipcRenderer.invoke('gcal-set-firebase-token', token),
    gcalOpenBrowserAuth: () => ipcRenderer.invoke('gcal-open-browser-auth'),
    onGcalImportedEvents: (callback) => {
        ipcRenderer.on('gcal-imported-events', (event, activities) => {
            callback(activities);
        });
    },
    openExternal: (url) => ipcRenderer.send('open-external', url)
});