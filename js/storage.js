/**
 * Storage Module - localStorage CRUD for orders, vendors, and client-vendor mappings
 * Supports Firebase Firestore integration and fallbacks to localStorage.
 */
const Storage = (() => {
    const KEYS = {
        ORDERS: 'clx_orders',
        VENDORS: 'clx_vendors',
        CLIENT_VENDOR: 'clx_client_vendor',
        NEXT_ID: 'clx_next_id',
        FIREBASE_CONFIG: 'clx_firebase_config'
    };

    const DEFAULT_VENDORS = [
        'Camila', 'Samuel', 'Bruno', 'Silvia', 'Leandro',
        'LIANG', 'BRUNA', 'MACIEL', 'PEDRO', 'DAYANA',
        'GILBERTO', 'PAULO', 'GABRIELA', 'GIVALDO', 'DAYSE', 'LARISSA'
    ];

    let _ordersCache = null; // Memory cache for Firebase sync

    function _get(key, fallback) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : fallback;
        } catch {
            return fallback;
        }
    }

    function _set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    // ─── Firebase Config ──────────────────────────────────
    function getFirebaseConfig() {
        return _get(KEYS.FIREBASE_CONFIG, null);
    }

    function saveFirebaseConfig(config) {
        _set(KEYS.FIREBASE_CONFIG, config);
    }

    // ─── Orders Cache ──────────────────────────────────────
    function setOrdersCache(orders) {
        _ordersCache = orders;
    }

    // ─── Orders ────────────────────────────────────────────
    function getOrders() {
        let orders = [];
        if (typeof SyncDB !== 'undefined' && SyncDB.isEnabled() && _ordersCache !== null) {
            orders = _ordersCache;
        } else {
            orders = _get(KEYS.ORDERS, []);
        }
        return orders.filter(o => !o.deleted);
    }

    function getOrderById(id) {
        return getOrders().find(o => o.id === id) || null;
    }

    function getNextId() {
        const id = _get(KEYS.NEXT_ID, 1);
        _set(KEYS.NEXT_ID, id + 1);
        return id;
    }

    async function saveOrder(order) {
        order.id = order.id || getNextId();
        order.createdAt = order.createdAt || new Date().toISOString();
        order.updatedAt = new Date().toISOString();

        if (typeof SyncDB !== 'undefined' && SyncDB.isEnabled()) {
            await SyncDB.saveOrder(order);
        } else {
            const orders = _get(KEYS.ORDERS, []);
            orders.unshift(order); // newest first
            _set(KEYS.ORDERS, orders);
        }

        // Auto-learn client-vendor mapping
        if (order.client && order.vendor) {
            setClientVendor(order.client.toUpperCase().trim(), order.vendor);
        }

        return order;
    }

    async function updateOrder(id, updates) {
        if (typeof SyncDB !== 'undefined' && SyncDB.isEnabled()) {
            await SyncDB.updateOrder(id, updates);
            const orders = getOrders();
            const order = orders.find(o => o.id === id);
            return order ? { ...order, ...updates } : null;
        }

        const rawOrders = _get(KEYS.ORDERS, []);
        const idx = rawOrders.findIndex(o => o.id === id);
        if (idx === -1) return null;

        const merged = { ...rawOrders[idx], ...updates, updatedAt: new Date().toISOString() };
        rawOrders[idx] = merged;
        _set(KEYS.ORDERS, rawOrders);

        // Auto-learn mapping on update too
        if (updates.client && merged.vendor) {
            setClientVendor(updates.client.toUpperCase().trim(), merged.vendor);
        }

        return merged;
    }

    async function deleteOrder(id) {
        if (typeof SyncDB !== 'undefined' && SyncDB.isEnabled()) {
            await SyncDB.deleteOrder(id);
        } else {
            const rawOrders = _get(KEYS.ORDERS, []);
            const idx = rawOrders.findIndex(o => o.id === id);
            if (idx !== -1) {
                rawOrders[idx].deleted = true;
                rawOrders[idx].updatedAt = new Date().toISOString();
                _set(KEYS.ORDERS, rawOrders);
            }
        }
    }

    // ─── Vendors ───────────────────────────────────────────
    function getVendors() {
        let vendors = _get(KEYS.VENDORS, null);
        if (!vendors) {
            vendors = [...DEFAULT_VENDORS];
            _set(KEYS.VENDORS, vendors);
        }
        return vendors;
    }

    function addVendor(name) {
        if (!name || !name.trim()) return false;
        const vendors = getVendors();
        const normalized = name.trim();
        if (vendors.some(v => v.toUpperCase() === normalized.toUpperCase())) return false;
        vendors.push(normalized);
        _set(KEYS.VENDORS, vendors);
        return true;
    }

    function removeVendor(name) {
        const vendors = getVendors().filter(v => v.toUpperCase() !== name.toUpperCase());
        _set(KEYS.VENDORS, vendors);
    }

    // ─── Client-Vendor Mapping (Auto-learn) ────────────────
    function getClientVendorMap() {
        return _get(KEYS.CLIENT_VENDOR, {});
    }

    function setClientVendor(client, vendor) {
        const map = getClientVendorMap();
        map[client.toUpperCase().trim()] = vendor;
        _set(KEYS.CLIENT_VENDOR, map);
    }

    function getVendorForClient(client) {
        if (!client) return null;
        const map = getClientVendorMap();
        return map[client.toUpperCase().trim()] || null;
    }

    // ─── Stats ─────────────────────────────────────────────
    function getStats() {
        const orders = getOrders();
        return {
            total: orders.length,
            pendente: orders.filter(o => o.status === 'pendente').length,
            separando: orders.filter(o => o.status === 'separando').length,
            concluido: orders.filter(o => o.status === 'concluido').length,
            withPhoto: orders.filter(o => o.photos && o.photos.length > 0).length
        };
    }

    return {
        getOrders, getOrderById, saveOrder, updateOrder, deleteOrder,
        getVendors, addVendor, removeVendor,
        getClientVendorMap, setClientVendor, getVendorForClient,
        getStats, DEFAULT_VENDORS,
        setOrdersCache
    };
})();
