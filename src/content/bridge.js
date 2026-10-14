/*
 * The content script's link to the extension's settings and to the page hook.
 *
 * Settings are read from storage and mirrored into the page's localStorage, where the hook reads
 * them synchronously on the next load, and posted to the hook for this one. Posts the hook has
 * seen are asked for by id.
 */
(function () {
    'use strict';

    const catalogue = globalThis.XPT_CATALOGUE;
    const SETTINGS_KEY = 'xpt:settings';
    const listeners = new Set();
    const outcomeListeners = new Map();
    const reloadListeners = new Set();
    const pending = new Map();
    let requestCounter = 0;

    const XPT = (globalThis.XPT = {
        catalogue,
        settings: catalogue.merge(readMirror()),
        on: (id) => catalogue.on(XPT.settings, id),
        opt: (id, key) => catalogue.opt(XPT.settings, id, key),
        onChange(listener) {
            listeners.add(listener);
        },

        /** Called when a settings change needs the page loaded anew to show. */
        onNeedsReload(listener) {
            reloadListeners.add(listener);
        },

        /**
         * Called with the hook's message whenever the server confirms an action of a kind:
         * 'follow' and 'block' ({ userId, state }), or 'feedback' ({ undo }).
         */
        onOutcome(type, listener) {
            if (!outcomeListeners.has(type)) outcomeListeners.set(type, new Set());
            outcomeListeners.get(type).add(listener);
        },

        /** Saves changed options of a patch. */
        async saveOptions(id, options) {
            const { settings: stored } = await browser.storage.local.get('settings');
            const next = catalogue.merge(stored);
            next.options[id] = { ...next.options[id], ...options };
            await browser.storage.local.set({ settings: next });
        },

        /** A post the page hook has seen: { post, raw? }, or { post: null }. */
        getPost(id, raw = false) {
            const requestId = `${Date.now()}-${++requestCounter}`;
            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    pending.delete(requestId);
                    resolve({ post: null });
                }, 3000);
                pending.set(requestId, (payload) => {
                    clearTimeout(timer);
                    resolve(payload);
                });
                send({ type: 'getPost', id, raw, requestId });
            });
        },

        /** One page of a post's replies, or the next page with a cursor: { conversation } or { error }. */
        getConversation(id, cursor = null) {
            const requestId = `${Date.now()}-${++requestCounter}`;
            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    pending.delete(requestId);
                    resolve({ error: 'X took too long to answer' });
                }, 20000);
                pending.set(requestId, (payload) => {
                    clearTimeout(timer);
                    resolve(payload);
                });
                send({ type: 'getConversation', id, cursor, requestId });
            });
        },

        /** Sends a message to the background. */
        background(message) {
            return browser.runtime.sendMessage(message);
        },
    });

    function readMirror() {
        try {
            return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        } catch {
            return null;
        }
    }

    function send(message) {
        window.postMessage('xpt:' + JSON.stringify({ to: 'page', ...message }), location.origin);
    }

    /**
     * The page hook read its settings from the mirror when the page loaded; when what it read
     * differs in a way only a new load picks up, listeners hear of it.
     */
    function apply(stored) {
        const before = XPT.settings;
        XPT.settings = catalogue.merge(stored);
        let mirrored = true;
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(XPT.settings));
        } catch {
            // Storage is full or blocked; the hook uses the defaults on the next load.
            mirrored = false;
        }
        if (mirrored && catalogue.needsReload(before, XPT.settings)) {
            for (const listener of reloadListeners) listener();
        }
        send({ type: 'settings', settings: XPT.settings });
        for (const listener of listeners) {
            try {
                listener(XPT.settings);
            } catch (error) {
                console.warn('[X Power Toys] Settings listener failed', error);
            }
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || typeof event.data !== 'string' || !event.data.startsWith('xpt:')) return;

        let message;
        try {
            message = JSON.parse(event.data.slice(4));
        } catch {
            return;
        }
        if (message.to !== 'ui') return;
        if (outcomeListeners.has(message.type)) {
            for (const listener of outcomeListeners.get(message.type)) {
                try {
                    listener(message);
                } catch (error) {
                    console.warn('[X Power Toys] Outcome listener failed', error);
                }
            }
            return;
        }
        if (message.type !== 'reply') return;

        const resolve = pending.get(message.requestId);
        if (!resolve) return;
        pending.delete(message.requestId);
        resolve({ post: message.post || null, raw: message.raw, conversation: message.conversation, error: message.error });
    });

    browser.storage.local.get('settings').then(({ settings }) => apply(settings));
    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) apply(changes.settings.newValue);
    });
})();
