// Firebase Configuration & Firestore Adapter
// Using Firebase Compat Libraries (loaded in index.html)

const firebaseConfig = {
  apiKey: "AIzaSyB1yiKA9P251QmwodaF_D3JMtNBRcGjn8o",
  authDomain: "todo-lits-team.firebaseapp.com",
  projectId: "todo-lits-team",
  storageBucket: "todo-lits-team.firebasestorage.app",
  messagingSenderId: "194544443505",
  appId: "1:194544443505:web:1b7f7c7f19d35462b9fbd0",
  measurementId: "G-797T5GB43W"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
    if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
    }
    window.db = firebase.firestore();
    try {
        if (firebaseConfig.measurementId && typeof firebase.analytics === 'function') {
            window.analytics = firebase.analytics();
        }
    } catch (e) {}
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
            if (typeof key === 'string' && key.endsWith('todos')) {
                const metaDoc = await window.db.collection(this.collectionName).doc(key + '__meta').get();
                if (metaDoc.exists) {
                    const meta = metaDoc.data() || {};
                    const chunkCount = Number(meta.chunkCount) || 0;
                    if (chunkCount > 0) {
                        const all = [];
                        for (let i = 0; i < chunkCount; i++) {
                            const chunkDoc = await window.db.collection(this.collectionName).doc(key + `__chunk_${i}`).get();
                            if (chunkDoc.exists) {
                                const v = chunkDoc.data() ? chunkDoc.data().value : null;
                                if (Array.isArray(v)) all.push(...v);
                            }
                        }
                        return all;
                    }
                }
            }

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

            const shouldChunkTodos = typeof key === 'string' && key.endsWith('todos') && Array.isArray(dataToStore);
            if (shouldChunkTodos) {
                const encoder = new TextEncoder();
                const maxBytes = 800 * 1024;
                const chunks = [];
                let current = [];
                let currentBytes = 0;

                const pushChunk = () => {
                    if (current.length > 0) {
                        chunks.push(current);
                        current = [];
                        currentBytes = 0;
                    }
                };

                for (const item of dataToStore) {
                    let itemBytes = 0;
                    try {
                        itemBytes = encoder.encode(JSON.stringify(item)).length;
                    } catch (e) {
                        itemBytes = 1024;
                    }
                    if (current.length > 0 && currentBytes + itemBytes > maxBytes) {
                        pushChunk();
                    }
                    current.push(item);
                    currentBytes += itemBytes;
                }
                pushChunk();

                const batch = window.db.batch();
                const metaRef = window.db.collection(this.collectionName).doc(key + '__meta');
                batch.set(metaRef, {
                    chunkCount: chunks.length,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                });

                chunks.forEach((chunk, i) => {
                    const ref = window.db.collection(this.collectionName).doc(key + `__chunk_${i}`);
                    batch.set(ref, {
                        value: chunk,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                    });
                });

                const legacyRef = window.db.collection(this.collectionName).doc(key);
                batch.set(legacyRef, {
                    value: [],
                    chunked: true,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                await batch.commit();
                return;
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
