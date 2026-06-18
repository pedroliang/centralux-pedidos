/**
 * Sync Module - Shared database sync over keyvalue.immanuel.co
 *
 * Robust protocol (v2):
 *  - Orders are stored as a single JSON array, split into chunks `db_<k>`.
 *  - A small control record `db_meta` { rev, len, checksum, count, ts } is
 *    written LAST. Readers verify the joined chunks against meta.len + checksum.
 *  - Torn reads (caught while another computer is mid-write) are DETECTED via
 *    the checksum and RETRIED, instead of dropping the client into a broken
 *    "offline" state where saves were silently lost.
 *  - Writes use optimistic concurrency on `rev`; if another computer wrote in
 *    between, we re-fetch, re-merge (Last-Write-Wins) and retry.
 *  - Every client keeps its own changes in localStorage and re-merges on each
 *    sync, so any lost write self-heals on the next cycle.
 *  - If the cloud is found corrupted, the client repairs it by rewriting a
 *    clean copy from its merged local data.
 *  - Legacy data (orders_chunks_count / orders_chunk_*) is migrated
 *    automatically on first run; the old keys are left intact as a backup.
 */
const SyncDB = (() => {
    let _enabled = true;
    let _onSyncCallback = null;
    let _pollInterval = null;
    let _appKey = 'clx_i626fy';
    let _isOnline = false;
    let _lastSyncTime = 0;

    let _lastSyncedRev = null;
    let _pendingPush = false;
    let _syncing = false;

    const META_KEY = 'db_meta';
    const CHUNK_PREFIX = 'db_';
    const CHUNK_SIZE = 900;
    const MAX_TORN_RETRIES = 4;
    const MAX_WRITE_RETRIES = 3;

    const LEGACY_COUNT_KEY = 'orders_chunks_count';
    const LEGACY_CHUNK_PREFIX = 'orders_chunk_';

    const LS_KEY = 'clx_orders';

    function _hash(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(36);
    }

    function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function _readLocalRaw() {
        try {
            const data = localStorage.getItem(LS_KEY);
            return data ? JSON.parse(data) : [];
        } catch { return []; }
    }

    function _writeLocalRaw(orders) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(orders)); }
        catch (e) { console.error('[SyncDB] Failed to persist local cache:', e); }
    }

    function getAppKeyFromSheetsId(sheetsId) {
        if (!sheetsId) return _appKey;
        let hash = 0;
        for (let i = 0; i < sheetsId.length; i++) {
            hash = (hash << 5) - hash + sheetsId.charCodeAt(i);
            hash |= 0;
        }
        return 'clx_' + Math.abs(hash).toString(36);
    }

    function isEnabled() { return _enabled; }
    function isOnline() { return _isOnline; }
    function getAppKey() { return _appKey; }
    function getLastSyncTime() { return _lastSyncTime; }

    function init() {
        if (typeof Sheets !== 'undefined' && Sheets.SPREADSHEET_ID) {
            _appKey = getAppKeyFromSheetsId(Sheets.SPREADSHEET_ID);
        }
        console.log(`[SyncDB] Initialized with App Key: ${_appKey}`);
    }

    async function fetchValue(key) {
        const url = `https://keyvalue.immanuel.co/api/KeyVal/GetValue/${_appKey}/${key}?_t=${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            if (res.status === 404) return null;
            throw new Error(`HTTP status ${res.status}`);
        }
        let data = await res.json();
        if (typeof data === 'string') {
            const trimmed = data.trim();
            if (trimmed === '' || trimmed === 'null') return null;
        }
        return data;
    }

    async function saveValue(key, value) {
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        const url = `https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/${_appKey}/${key}?value=${encodeURIComponent(valStr)}`;
        const res = await fetch(url, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);
        return true;
    }

    function _parseMaybeJson(data) {
        if (data == null) return null;
        if (typeof data !== 'string') return data;
        try { return JSON.parse(data); } catch { return data; }
    }

    async function _readLegacy() {
        const countData = await fetchValue(LEGACY_COUNT_KEY);
        const count = countData ? parseInt(countData, 10) : 0;
        if (!count || count <= 0) return null;
        const promises = [];
        for (let i = 0; i < count; i++) promises.push(fetchValue(`${LEGACY_CHUNK_PREFIX}${i}`));
        const chunks = await Promise.all(promises);
        if (chunks.some(c => c == null)) return null;
        try {
            const data = JSON.parse(chunks.join(''));
            return Array.isArray(data) ? data : null;
        } catch { return null; }
    }

    async function _readSnapshot(metaHint) {
        let meta = metaHint;
        if (meta === undefined) meta = _parseMaybeJson(await fetchValue(META_KEY));

        if (!meta || typeof meta !== 'object' || typeof meta.count !== 'number') {
            const legacy = await _readLegacy();
            if (legacy) return { orders: legacy, rev: 0, fromLegacy: true, empty: false };
            return { orders: [], rev: 0, fromLegacy: false, empty: true };
        }

        for (let attempt = 0; attempt < MAX_TORN_RETRIES; attempt++) {
            const promises = [];
            for (let i = 0; i < meta.count; i++) promises.push(fetchValue(`${CHUNK_PREFIX}${i}`));
            const chunks = await Promise.all(promises);

            if (!chunks.some(c => c == null)) {
                const joined = chunks.join('');
                const okLen = (meta.len == null) || joined.length === meta.len;
                const okSum = (meta.checksum == null) || _hash(joined) === meta.checksum;
                if (okLen && okSum) {
                    try {
                        const data = JSON.parse(joined);
                        if (Array.isArray(data)) {
                            return { orders: data, rev: meta.rev || 0, fromLegacy: false, empty: false };
                        }
                    } catch { /* retry */ }
                }
            }

            await _sleep(250 + attempt * 200);
            meta = _parseMaybeJson(await fetchValue(META_KEY)) || meta;
        }

        const err = new Error('Torn read: cloud data inconsistent after retries');
        err.torn = true;
        throw err;
    }

    async function _writeSnapshot(orders, newRev) {
        const str = JSON.stringify(orders);
        const chunks = [];
        for (let i = 0; i < str.length; i += CHUNK_SIZE) chunks.push(str.substring(i, i + CHUNK_SIZE));
        if (chunks.length === 0) chunks.push('');

        await Promise.all(chunks.map((c, i) => saveValue(`${CHUNK_PREFIX}${i}`, c)));

        const meta = {
            rev: newRev,
            len: str.length,
            checksum: _hash(str),
            count: chunks.length,
            ts: Date.now()
        };
        await saveValue(META_KEY, JSON.stringify(meta));
        return meta;
    }

    function mergeOrders(local, remote) {
        if (!local) local = [];
        if (!remote) remote = [];
        const map = new Map();
        local.forEach(o => map.set(o.id, o));
        remote.forEach(remoteOrder => {
            const localOrder = map.get(remoteOrder.id);
            if (!localOrder) {
                map.set(remoteOrder.id, remoteOrder);
            } else {
                const localTime = new Date(localOrder.updatedAt || localOrder.createdAt || 0).getTime();
                const remoteTime = new Date(remoteOrder.updatedAt || remoteOrder.createdAt || 0).getTime();
                if (remoteTime > localTime) map.set(remoteOrder.id, remoteOrder);
            }
        });
        return Array.from(map.values()).sort((a, b) => b.id - a.id);
    }

    function _sameOrders(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    async function sync(force = false) {
        if (_syncing) return;
        _syncing = true;
        try {
            const localRaw = _readLocalRaw();

            let metaHint;
            try {
                metaHint = _parseMaybeJson(await fetchValue(META_KEY));
                _isOnline = true;
                _lastSyncTime = Date.now();
            } catch (netErr) {
                console.warn('[SyncDB] Offline (meta fetch failed):', netErr.message);
                _isOnline = false;
                _emit(localRaw);
                return;
            }

            const remoteRev = (metaHint && typeof metaHint === 'object') ? (metaHint.rev || 0) : null;
            if (!force && !_pendingPush && remoteRev !== null && remoteRev === _lastSyncedRev) {
                _isOnline = true;
                _emit(localRaw);
                return;
            }

            let snap;
            try {
                snap = await _readSnapshot(metaHint);
                _isOnline = true;
            } catch (e) {
                if (e && e.torn) {
                    console.warn('[SyncDB] Cloud corrupted -> repairing from local data');
                    const repairRev = (remoteRev || 0) + 1;
                    try {
                        await _writeSnapshot(localRaw, repairRev);
                        _lastSyncedRev = repairRev;
                        _pendingPush = false;
                        _isOnline = true;
                    } catch (werr) {
                        console.error('[SyncDB] Repair write failed:', werr.message);
                        _isOnline = false;
                    }
                    _emit(localRaw);
                    return;
                }
                console.warn('[SyncDB] Offline (snapshot read failed):', e.message);
                _isOnline = false;
                _emit(localRaw);
                return;
            }

            const merged = mergeOrders(localRaw, snap.orders);
            _writeLocalRaw(merged);

            const needWrite = snap.fromLegacy || !_sameOrders(merged, snap.orders);
            if (needWrite) {
                await _writeWithRetry(merged, snap.rev);
            } else {
                _lastSyncedRev = snap.rev;
                _pendingPush = false;
            }

            _emit(merged);
        } finally {
            _syncing = false;
        }
    }

    async function _writeWithRetry(initialMerged, baseRev) {
        let merged = initialMerged;
        let base = baseRev;

        for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
            const newRev = (base || 0) + 1;
            try {
                await _writeSnapshot(merged, newRev);
            } catch (werr) {
                console.error('[SyncDB] Write failed:', werr.message);
                _isOnline = false;
                return;
            }

            let confirmed = null;
            try { confirmed = _parseMaybeJson(await fetchValue(META_KEY)); }
            catch { /* treat as confirmed */ }

            if (!confirmed || confirmed.rev === newRev || confirmed.rev == null) {
                _lastSyncedRev = newRev;
                _pendingPush = false;
                _isOnline = true;
                _writeLocalRaw(merged);
                return;
            }

            try {
                const snap = await _readSnapshot(confirmed);
                merged = mergeOrders(merged, snap.orders);
                base = snap.rev;
                _writeLocalRaw(merged);
            } catch {
                base = confirmed.rev || base;
            }
        }

        _pendingPush = true;
        console.warn('[SyncDB] Could not confirm write after retries; will retry on next poll');
    }

    function _emit(rawOrders) {
        if (_onSyncCallback) _onSyncCallback(rawOrders.filter(o => !o.deleted));
    }

    async function saveOrder(order) {
        const localRaw = _readLocalRaw();
        localRaw.unshift(order);
        _writeLocalRaw(localRaw);
        _pendingPush = true;
        sync(true).catch(console.error);
        return order;
    }

    async function updateOrder(id, updates) {
        const localRaw = _readLocalRaw();
        const idx = localRaw.findIndex(o => o.id === id);
        if (idx !== -1) {
            localRaw[idx] = { ...localRaw[idx], ...updates, updatedAt: new Date().toISOString() };
            _writeLocalRaw(localRaw);
        }
        _pendingPush = true;
        sync(true).catch(console.error);
    }

    async function deleteOrder(id) {
        const localRaw = _readLocalRaw();
        const idx = localRaw.findIndex(o => o.id === id);
        if (idx !== -1) {
            localRaw[idx] = { ...localRaw[idx], deleted: true, updatedAt: new Date().toISOString() };
            _writeLocalRaw(localRaw);
        }
        _pendingPush = true;
        sync(true).catch(console.error);
    }

    function startSync(onSync) {
        _onSyncCallback = onSync;
        sync(true).catch(console.error);
        if (_pollInterval) clearInterval(_pollInterval);
        _pollInterval = setInterval(() => { sync().catch(console.error); }, 15000);
    }

    function stopSync() {
        if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
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
        forceSync: () => sync(true),
        _internals: { mergeOrders, _hash }
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncDB;
}
