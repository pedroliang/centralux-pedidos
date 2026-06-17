/**
 * Sheets Module - Google Sheets integration for auto-complete
 * Fetches data from "relatorio de saida" sheet and provides code → client lookup
 */
const Sheets = (() => {
    const SPREADSHEET_ID = '1fRqUo8vH4awjCwV12U0fhR2bdBSRGFUVMlU8PozUsoQ';
    const SHEET_NAME = 'relatorio de saida';
    const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

    let _cache = null;
    let _lastFetch = 0;
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    /**
     * Parse CSV text into array of objects
     */
    function parseCSV(text) {
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];

        const results = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length >= 2 && values[0]) {
                results.push({
                    code: values[0].replace(/"/g, '').trim(),
                    description: values[1].replace(/"/g, '').trim()
                });
            }
        }
        return results;
    }

    /**
     * Parse a single CSV line respecting quoted fields
     */
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }

    /**
     * Fetch and cache spreadsheet data
     */
    async function fetchData(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && _cache && (now - _lastFetch) < CACHE_DURATION) {
            return _cache;
        }

        try {
            const response = await fetch(CSV_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            _cache = parseCSV(text);
            _lastFetch = now;
            console.log(`[Sheets] Loaded ${_cache.length} products from Google Sheets`);
            return _cache;
        } catch (err) {
            console.error('[Sheets] Failed to fetch:', err);
            return _cache || [];
        }
    }

    /**
     * Find product by exact code match
     * @returns {object|null} { code, description } or null
     */
    async function findByCode(code) {
        if (!code) return null;
        const data = await fetchData();
        const normalized = code.toString().trim();
        return data.find(item => item.code === normalized) || null;
    }

    /**
     * Search products by code prefix match (column A only)
     * @returns {Array} matching products whose code STARTS with the input
     */
    async function searchByCode(partial) {
        if (!partial) return [];
        const data = await fetchData();
        const normalized = partial.toString().trim();
        return data.filter(item =>
            item.code.startsWith(normalized)
        ).slice(0, 10);
    }

    /**
     * Pre-load data on init
     */
    function init() {
        fetchData().catch(() => {});
    }

    return { fetchData, findByCode, searchByCode, init };
})();
