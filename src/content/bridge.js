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
    const followListeners = new Set();
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

        /** Called with (userId, state) whenever the server confirms a follow, unfollow or cancel. */
        onFollow(listener) {
            followListeners.add(listener);
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

    function apply(stored) {
        XPT.settings = catalogue.merge(stored);
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(XPT.settings));
        } catch {
            // Storage is full or blocked; the hook uses the defaults on the next load.
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
        if (message.type === 'follow') {
            for (const listener of followListeners) listener(String(message.userId), String(message.state));
            return;
        }
        if (message.type !== 'reply') return;

        const resolve = pending.get(message.requestId);
        if (!resolve) return;
        pending.delete(message.requestId);
        resolve({ post: message.post || null, raw: message.raw });
    });

    browser.storage.local.get('settings').then(({ settings }) => apply(settings));
    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) apply(changes.settings.newValue);
    });
})();
