// Firebase configuration template
// Copy this file to firebase-config.js and fill in your Firebase project details
// Get these values from: Firebase Console > Project Settings > Your apps > Web app
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID" // Optional
};

// Export for browser use
window.firebaseConfig = firebaseConfig;
