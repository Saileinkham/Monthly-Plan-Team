// Firebase Configuration & Firestore Adapter
// Using Firebase Compat Libraries (loaded in index.html)

const firebaseConfig = {
  apiKey: "AIzaSyB1yiKA9P251QmwodaF_D3JMtNBRcGjn8o",
  authDomain: "monthly-plan-d0me.firebaseapp.com",
  projectId: "monthly-plan-d0me",
  storageBucket: "monthly-plan-d0me.appspot.com", // Inferred or standard
  messagingSenderId: "1078322637255", // Inferred or standard
  appId: "1:1078322637255:web:c077478059089901d2c672",
  measurementId: "G-96G8506X46"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    window.db = firebase.firestore();
    window.analytics = firebase.analytics();
    console.log("Firebase initialized");
} else {
    console.error("Firebase SDK not loaded!");
}

// Firestore Adapter to bridge existing logic with Firestore
window.FirestoreAdapter = {
    // Collection to store all app data (mimicking localStorage key-value structure)
    // For better scalability, you might want to use proper collections later.
    collectionName: 'app_data',
    
    async getItem(key) {
        if (!window.db) return null;
        try {
            const doc = await window.db.collection(this.collectionName).doc(key).get();
            if (doc.exists) {
                // Return the 'value' field which contains the JSON object/array
                return doc.data().value;
            }
            return null;
        } catch (e) {
            console.error(`Error reading ${key} from Firestore:`, e);
            return null;
        }
    },

    async setItem(key, value) {
        if (!window.db) return;
        try {
            // value is expected to be an object/array (not stringified)
            // If it is stringified, we try to parse it first
            let dataToStore = value;
            if (typeof value === 'string') {
                try {
                    dataToStore = JSON.parse(value);
                } catch (e) {
                    // It's a raw string
                }
            }
            
            await window.db.collection(this.collectionName).doc(key).set({ 
                value: dataToStore,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error(`Error writing ${key} to Firestore:`, e);
        }
    },

    // Specific helpers
    async getUsers() {
        return await this.getItem('users');
    },

    async saveUsers(users) {
        await this.setItem('users', users);
    }
};
