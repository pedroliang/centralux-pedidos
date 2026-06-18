/**
 * Sync Module - Manages shared database sync using keyvalue.immanuel.co
 * Implements Last-Write-Wins (LWW) merge logic and soft deletes.
 */
const SyncDB = (() => {
    let _enabled = true; // Enabled by default for zero-config
    let _onSyncCallback = null;
    let _pollInterval = null;
    let _appKey = 'clx_i626fy'; // Fallback default key
    const KEY_ORDERS = 'orders';
    let _isOnline = false;
    let _lastSyncTime = 0;

    /**
     * Compute a deterministic hash from spreadsheet ID
     */
    function getAppKeyFromSheetsId(sheetsId) {
        if (!sheetsId) return _appKey;
        let hash = 0;
        for (let i = 0; i < sheetsId.length; i++) {
            hash = (hash << 5) - hash + sheetsId.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return 'clx_' + Math.abs(hash).toString(36);
    }

    function isEnabled() {
        return _enabled;
    }

    function isOnline() {
        return _isOnline;
    }

    function getAppKey() {
        return _appKey;
    }

    function getLastSyncTime() {
        return _lastSyncTime;
    }

    /**
     * Initialize Sync Module
     */
    function init() {
        // Derive appKey from Google Sheets ID if available
        if (typeof Sheets !== 'undefined' && Sheets.SPREADSHEET_ID) {
            _appKey = getAppKeyFromSheetsId(Sheets.SPREADSHEET_ID);
        }
        console.log(`[SyncDB] Initialized with App Key: ${_appKey}`);
    }

    /**
     * Helper to fetch a key from the remote key-value store
     */
    async function fetchValue(key) {
        // Use a cache buster query parameter to guarantee no caching by the browser or proxies
        const url = `https://keyvalue.immanuel.co/api/KeyVal/GetValue/${_appKey}/${key}?_t=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            if (res.status === 404) return null;
            throw new Error(`HTTP status ${res.status}`);
        }
        let data = await res.json();
        if (typeof data === 'string') {
            try {
                const trimmed = data.trim();
                if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                    data = JSON.parse(trimmed);
                }
            } catch (e) {
                console.warn(`[SyncDB] Failed to parse key ${key} as JSON:`, e);
            }
        }
        return data;
    }

    /**
     * Helper to save a key to the remote key-value store
     */
    async function saveValue(key, value) {
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        const url = `https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/${_appKey}/${key}?value=${encodeURIComponent(valStr)}`;
        const res = await fetch(url, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);
        return true;
    }

    /**
     * Fetch orders from remote key-value store using chunking
     */
    async function fetchRemoteOrders() {
        try {
            // Check chunk count first
            const countData = await fetchValue(`${KEY_ORDERS}_chunks_count`);
            let count = countData ? parseInt(countData, 10) : 0;

            let data;
            if (count > 0) {
                // Fetch all chunks in parallel
                const chunkPromises = [];
                for (let i = 0; i < count; i++) {
                    chunkPromises.push(fetchValue(`${KEY_ORDERS}_chunk_${i}`));
                }
                const chunks = await Promise.all(chunkPromises);
                
                // Verify all chunks fetched successfully
                if (chunks.some(c => c === null || c === undefined)) {
                    throw new Error('Some database chunks are missing or corrupted');
                }

                const fullJsonStr = chunks.join('');
                data = JSON.parse(fullJsonStr);
            } else {
                // Fallback to legacy single key if count is missing/0
                data = await fetchValue(KEY_ORDERS);
            }

            _isOnline = true;
            _lastSyncTime = Date.now();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.warn('[SyncDB] Failed to fetch remote orders, using offline mode:', err);
            _isOnline = false;
            return null;
        }
    }

    /**
     * Save orders to remote key-value store using chunking to bypass URL limits
     */
    async function saveRemoteOrders(orders) {
        try {
            const valStr = JSON.stringify(orders);
            const chunkSize = 900;
            const chunks = [];
            for (let i = 0; i < valStr.length; i += chunkSize) {
                chunks.push(valStr.substring(i, i + chunkSize));
            }

            // Save all chunks in parallel
            await Promise.all(chunks.map((chunk, idx) => saveValue(`${KEY_ORDERS}_chunk_${idx}`, chunk)));

            // Save chunk count
            await saveValue(`${KEY_ORDERS}_chunks_count`, chunks.length.toString());

            _isOnline = true;
            _lastSyncTime = Date.now();
            return true;
        } catch (err) {
            console.error('[SyncDB] Failed to save remote orders:', err);
            _isOnline = false;
            return false;
        }
    }

    /**
     * Merge local and remote orders using Last-Write-Wins (LWW)
     */
    function mergeOrders(local, remote) {
        if (!local) local = [];
        if (!remote) remote = [];

        const map = new Map();
        
        // Load local orders
        local.forEach(o => map.set(o.id, o));

        // Load remote orders and resolve conflicts
        remote.forEach(remoteOrder => {
            const localOrder = map.get(remoteOrder.id);
            if (!localOrder) {
                map.set(remoteOrder.id, remoteOrder);
            } else {
                const localTime = new Date(localOrder.updatedAt || localOrder.createdAt || 0).getTime();
                const remoteTime = new Date(remoteOrder.updatedAt || remoteOrder.createdAt || 0).getTime();
                if (remoteTime > localTime) {
                    map.set(remoteOrder.id, remoteOrder);
                }
            }
        });

        // Return sorted by id (newest first)
        return Array.from(map.values()).sort((a, b) => b.id - a.id);
    }

    /**
     * Synchronize and merge local cache with cloud database
     */
    async function sync() {
        // Get raw orders from local storage (including soft-deleted ones)
        let localRaw = [];
        try {
            const data = localStorage.getItem('clx_orders');
            localRaw = data ? JSON.parse(data) : [];
        } catch {}

        const remoteRaw = await fetchRemoteOrders();
        if (remoteRaw === null) {
            // Offline or error: trigger callback with local cache only
            if (_onSyncCallback) {
                const filtered = localRaw.filter(o => !o.deleted);
                _onSyncCallback(filtered);
            }
            return;
        }

        // Merge arrays using LWW
        const merged = mergeOrders(localRaw, remoteRaw);

        // Update local storage so backup is always current
        localStorage.setItem('clx_orders', JSON.stringify(merged));

        // If the merged result has changes not yet in the cloud, push them
        // (e.g. if we had offline edits, or remote had updates that merged)
        const mergedStr = JSON.stringify(merged);
        const remoteStr = JSON.stringify(remoteRaw);
        if (mergedStr !== remoteStr) {
            await saveRemoteOrders(merged);
        }

        // Notify app of new orders (filtering out soft deleted ones)
        if (_onSyncCallback) {
            const filtered = merged.filter(o => !o.deleted);
            _onSyncCallback(filtered);
        }
    }

    /**
     * Save/Create a new order
     */
    async function saveOrder(order) {
        let localRaw = [];
        try {
            const data = localStorage.getItem('clx_orders');
            localRaw = data ? JSON.parse(data) : [];
        } catch {}

        // Add to local array
        localRaw.unshift(order);
        localStorage.setItem('clx_orders', JSON.stringify(localRaw));

        // Sync immediately in background
        sync().catch(console.error);
        return order;
    }

    /**
     * Update an existing order
     */
    async function updateOrder(id, updates) {
        let localRaw = [];
        try {
            const data = localStorage.getItem('clx_orders');
            localRaw = data ? JSON.parse(data) : [];
        } catch {}

        const idx = localRaw.findIndex(o => o.id === id);
        if (idx !== -1) {
            localRaw[idx] = { ...localRaw[idx], ...updates, updatedAt: new Date().toISOString() };
            localStorage.setItem('clx_orders', JSON.stringify(localRaw));
        }

        // Sync immediately in background
        sync().catch(console.error);
    }

    /**
     * Soft delete an order
     */
    async function deleteOrder(id) {
        let localRaw = [];
        try {
            const data = localStorage.getItem('clx_orders');
            localRaw = data ? JSON.parse(data) : [];
        } catch {}

        const idx = localRaw.findIndex(o => o.id === id);
        if (idx !== -1) {
            localRaw[idx] = { ...localRaw[idx], deleted: true, updatedAt: new Date().toISOString() };
            localStorage.setItem('clx_orders', JSON.stringify(localRaw));
        }

        // Sync immediately in background
        sync().catch(console.error);
    }

    /**
     * Start real-time sync polling
     */
    function startSync(onSync) {
        _onSyncCallback = onSync;
        
        // Initial sync
        sync().catch(console.error);

        // Poll every 15 seconds
        if (_pollInterval) clearInterval(_pollInterval);
        _pollInterval = setInterval(() => {
            sync().catch(console.error);
        }, 15000);
    }

    /**
     * Stop sync polling
     */
    function stopSync() {
        if (_pollInterval) {
            clearInterval(_pollInterval);
            _pollInterval = null;
        }
    }

    return {
        init,
        isEnabled,
        isOnline,
        getAppKey,
        getLastSyncTime,
        saveOrder,
        updateOrder,
        deleteOrder,
        startSync,
        stopSync,
        forceSync: sync
    };
})();
