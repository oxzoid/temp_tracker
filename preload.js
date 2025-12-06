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
    closeWindow: () => ipcRenderer.send('window-close')
});