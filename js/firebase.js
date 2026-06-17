/**
 * Firebase Module - Manages shared Firestore database sync
 */
const FirebaseDB = (() => {
    let _db = null;
    let _enabled = false;
    let _onSyncCallback = null;
    let _unsubscribe = null;

    function isEnabled() {
        return _enabled;
    }

    /**
     * Initialize Firebase using saved config credentials
     */
    function init() {
        const config = Storage.getFirebaseConfig();
        if (config && config.apiKey && config.projectId) {
            try {
                if (firebase.apps.length === 0) {
                    firebase.initializeApp(config);
                }
                _db = firebase.firestore();
                _enabled = true;
                console.log('[Firebase] Initialized successfully');
            } catch (err) {
                console.error('[Firebase] Init error:', err);
                _enabled = false;
            }
        } else {
            console.log('[Firebase] No config found, running in localStorage mode');
            _enabled = false;
        }
    }

    /**
     * Save/Create a new order in Firestore
     */
    async function saveOrder(order) {
        if (!_enabled || !_db) return null;
        const docId = order.id.toString();
        await _db.collection('orders').doc(docId).set(order);
        return order;
    }

    /**
     * Update an existing order in Firestore
     */
    async function updateOrder(id, updates) {
        if (!_enabled || !_db) return null;
        const docId = id.toString();
        const data = { ...updates, updatedAt: new Date().toISOString() };
        await _db.collection('orders').doc(docId).update(data);
    }

    /**
     * Delete an order from Firestore
     */
    async function deleteOrder(id) {
        if (!_enabled || !_db) return;
        const docId = id.toString();
        await _db.collection('orders').doc(docId).delete();
    }

    /**
     * Start real-time Firestore sync listener
     */
    function startSync(onSync) {
        if (!_enabled || !_db) return;
        _onSyncCallback = onSync;

        if (_unsubscribe) _unsubscribe();

        _unsubscribe = _db.collection('orders')
            .orderBy('createdAt', 'desc')
            .onSnapshot((snapshot) => {
                const orders = [];
                snapshot.forEach(doc => {
                    orders.push(doc.data());
                });
                if (_onSyncCallback) {
                    _onSyncCallback(orders);
                }
            }, (err) => {
                console.error('[Firebase] Sync error:', err);
            });
    }

    /**
     * Stop real-time sync
     */
    function stopSync() {
        if (_unsubscribe) {
            _unsubscribe();
            _unsubscribe = null;
        }
    }

    return {
        init,
        isEnabled,
        saveOrder,
        updateOrder,
        deleteOrder,
        startSync,
        stopSync
    };
})();
