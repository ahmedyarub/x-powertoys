/*
 * Work the page cannot do: downloads into the chosen folder, fetching images for Share as image,
 * the login token, clearing the site's cache, and opening custom frontend links on x.com.
 */
'use strict';

const catalogue = globalThis.XPT_CATALOGUE;
const MEDIA_HOSTS = /^(?:pbs|video|abs)\.twimg\.com$/;
const LOGIN_COOKIES = ['auth_token', 'ct0', 'twid', 'kdt'];
const LINK_RULE_ID = 1;

async function settings() {
    const { settings: stored } = await browser.storage.local.get('settings');
    return catalogue.merge(stored);
}

// region Downloads

/** The download folder, relative to the browser's downloads folder, without empty or parent parts. */
function folder(current) {
    if (!catalogue.on(current, 'customDownloadFolder')) return 'X';
    return String(catalogue.opt(current, 'customDownloadFolder', 'folder') || '')
        .split(/[\\/]+/)
        .map((part) => part.trim().replace(/[<>:"|?*]/g, '_'))
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/');
}

function safeName(name) {
    return String(name).replace(/[\\/<>:"|?*]/g, '_').slice(0, 180) || 'download';
}

function isMediaUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && MEDIA_HOSTS.test(parsed.hostname);
    } catch {
        return false;
    }
}

async function download(items) {
    const current = await settings();
    const dir = folder(current);
    for (const item of items) {
        if (!isMediaUrl(item.url)) throw new Error('Not an X media link');
        await browser.downloads.download({
            url: item.url,
            filename: dir ? `${dir}/${safeName(item.filename)}` : safeName(item.filename),
            conflictAction: 'uniquify',
        });
    }
}

async function downloadData(dataUrl, filename) {
    if (!/^data:image\/png;base64,/.test(dataUrl)) throw new Error('Not a PNG');
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const current = await settings();
    const dir = folder(current);
    try {
        await browser.downloads.download({ url, filename: dir ? `${dir}/${safeName(filename)}` : safeName(filename), conflictAction: 'uniquify' });
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
}

async function fetchImage(url) {
    if (!isMediaUrl(url)) throw new Error('Not an X media link');
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// endregion

// region Login token

async function exportLogin() {
    const cookies = await browser.cookies.getAll({ domain: 'x.com' });
    const login = cookies
        .filter((cookie) => LOGIN_COOKIES.includes(cookie.name))
        .map(({ name, value, domain, path, secure, httpOnly, sameSite, expirationDate }) =>
            ({ name, value, domain, path, secure, httpOnly, sameSite, expirationDate }));
    if (!login.some((cookie) => cookie.name === 'auth_token')) throw new Error('Not logged in to x.com in this browser');
    return JSON.stringify({ format: 'x-powertoys-login', version: 1, cookies: login });
}

async function importLogin(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('That is not an exported login');
    }
    const cookies = Array.isArray(data?.cookies) ? data.cookies : [];
    const login = cookies.filter((cookie) => LOGIN_COOKIES.includes(cookie?.name) && typeof cookie.value === 'string');
    if (!login.some((cookie) => cookie.name === 'auth_token')) throw new Error('The export has no auth_token');

    const year = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    for (const cookie of login) {
        await browser.cookies.set({
            url: 'https://x.com/',
            name: cookie.name,
            value: cookie.value,
            domain: '.x.com',
            path: '/',
            secure: true,
            httpOnly: cookie.httpOnly === true,
            sameSite: ['no_restriction', 'lax', 'strict'].includes(cookie.sameSite) ? cookie.sameSite : 'no_restriction',
            expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : year,
        });
    }
}

// endregion

// region Delete from database

async function clearCache() {
    await browser.browsingData.remove(
        { hostnames: ['x.com', 'twitter.com'] },
        { indexedDB: true, serviceWorkers: true },
    );
}

// endregion

// region Handle custom twitter links

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Redirects pages on the custom hosts, and their subdomains, to the same path on x.com. */
async function syncLinkRules(current) {
    const hosts = catalogue.on(current, 'handleCustomLinks')
        ? (catalogue.opt(current, 'handleCustomLinks', 'hosts') || [])
            .map((host) => host.trim().toLowerCase())
            .filter((host) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !/(^|\.)(x|twitter)\.com$/.test(host))
        : [];

    const addRules = hosts.length ? [{
        id: LINK_RULE_ID,
        priority: 1,
        action: { type: 'redirect', redirect: { regexSubstitution: 'https://x.com/\\1' } },
        condition: {
            regexFilter: `^https?://(?:[a-z0-9-]+\\.)*(?:${hosts.map(escapeRegex).join('|')})/(.*)$`,
            resourceTypes: ['main_frame'],
        },
    }] : [];

    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [LINK_RULE_ID], addRules });
}

// endregion

browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return undefined;

    const handle = async () => {
        switch (message?.type) {
            case 'download':
                await download(Array.isArray(message.items) ? message.items : []);
                return {};
            case 'downloadData':
                await downloadData(message.dataUrl, message.filename);
                return {};
            case 'fetchImage':
                return { dataUrl: await fetchImage(message.url) };
            case 'exportLogin':
                return { text: await exportLogin() };
            case 'importLogin':
                await importLogin(message.text);
                return {};
            case 'clearCache':
                await clearCache();
                return {};
            default:
                return { error: 'Unknown message' };
        }
    };
    return handle().catch((error) => ({ error: error?.message || String(error) }));
});

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) syncLinkRules(catalogue.merge(changes.settings.newValue)).catch(console.warn);
});

browser.runtime.onInstalled.addListener(async () => {
    const current = await settings();
    await browser.storage.local.set({ settings: current });
    await syncLinkRules(current);
});

browser.runtime.onStartup.addListener(async () => syncLinkRules(await settings()).catch(console.warn));
