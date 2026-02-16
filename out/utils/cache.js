"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimedCache = void 0;
class TimedCache {
    ttlMs;
    store = new Map();
    constructor(ttlMinutes) {
        this.ttlMs = ttlMinutes * 60 * 1000;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value;
    }
    set(key, value) {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }
    delete(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}
exports.TimedCache = TimedCache;
//# sourceMappingURL=cache.js.map