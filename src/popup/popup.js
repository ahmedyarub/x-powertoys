'use strict';

const catalogue = globalThis.XPT_CATALOGUE;
let settings = catalogue.defaults();

const saveButton = document.getElementById('save');
const status = document.getElementById('status');

function changed() {
    saveButton.disabled = false;
    status.textContent = 'Not saved yet.';
}

/** Saves the edits; open x.com pages refresh to show them. */
async function save() {
    saveButton.disabled = true;
    const { settings: stored } = await browser.storage.local.get('settings');
    const next = catalogue.merge(stored);
    for (const control of document.querySelectorAll('[data-patch]')) {
        const { patch, key } = control.dataset;
        next.options[patch][key] = settings.options[patch][key];
    }
    await browser.storage.local.set({ settings: next });
    settings = next;
    status.textContent = 'Saved. x.com is refreshing.';
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
                changed();
            });
        } else {
            control.value = value.join('\n');
            control.addEventListener('input', () => {
                settings.options[patch][key] = control.value.split('\n').map((line) => line.trim()).filter(Boolean);
                changed();
            });
        }
    }
}

saveButton.addEventListener('click', () => save().catch((error) => {
    saveButton.disabled = false;
    status.textContent = `Could not save: ${error.message}`;
}));

document.getElementById('settings').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
    window.close();
});

browser.storage.local.get('settings').then(({ settings: stored }) => {
    settings = catalogue.merge(stored);
    bind();
});
