'use strict';

const catalogue = globalThis.XPT_CATALOGUE;
let settings = catalogue.defaults();
let saveTimer = null;

function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        await browser.storage.local.set({ settings });
        document.getElementById('status').textContent = 'Saved. Reload x.com to apply.';
    }, 250);
}

function bind() {
    document.getElementById('feed').hidden = !settings.patches.feedFilters;
    document.getElementById('keywords').hidden = !settings.patches.filterByKeyword;

    for (const control of document.querySelectorAll('[data-patch]')) {
        const { patch, key } = control.dataset;
        const value = settings.options[patch][key];
        if (control.type === 'checkbox') {
            control.checked = value === true;
            control.addEventListener('change', () => {
                settings.options[patch][key] = control.checked;
                save();
            });
        } else {
            control.value = value.join('\n');
            control.addEventListener('input', () => {
                settings.options[patch][key] = control.value.split('\n').map((line) => line.trim()).filter(Boolean);
                save();
            });
        }
    }
}

document.getElementById('settings').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
    window.close();
});

document.getElementById('reload').addEventListener('click', async () => {
    const tabs = await browser.tabs.query({ url: ['*://x.com/*', '*://*.x.com/*', '*://twitter.com/*'] });
    for (const tab of tabs) browser.tabs.reload(tab.id);
    window.close();
});

browser.storage.local.get('settings').then(({ settings: stored }) => {
    settings = catalogue.merge(stored);
    bind();
});
