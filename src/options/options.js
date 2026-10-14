'use strict';

const catalogue = globalThis.XPT_CATALOGUE;
let settings = catalogue.defaults();

async function load() {
    const { settings: stored } = await browser.storage.local.get('settings');
    settings = catalogue.merge(stored);
}

let saveTimer = null;
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        await browser.storage.local.set({ settings });
        status('save-status', 'Saved. x.com refreshes by itself when a change needs it.');
    }, 250);
}

function status(id, text, error = false) {
    const element = document.getElementById(id);
    element.textContent = text;
    element.classList.toggle('error', error);
}

function element(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
}

// region Rendering

function optionControl(patch, option) {
    const id = `${patch.id}-${option.key}`;
    const value = settings.options[patch.id][option.key];
    const set = (next) => {
        settings.options[patch.id][option.key] = next;
        save();
    };
    const hint = option.description ? element('span', { className: 'hint', text: option.description }) : null;

    switch (option.type) {
        case 'bool': {
            const box = element('input', { type: 'checkbox', id, onchange: () => set(box.checked) });
            box.checked = value === true;
            return element('div', { className: 'option' }, element('label', { className: 'check', for: id }, box, option.title), hint);
        }
        case 'text': {
            const input = element('input', { type: 'text', id, spellcheck: 'false', oninput: () => set(input.value.trim()) });
            input.value = value;
            return element('div', { className: 'option' }, element('label', { className: 'title', for: id, text: option.title }), input, hint);
        }
        case 'int': {
            const input = element('input', {
                type: 'number', id, min: String(option.min), max: String(option.max), step: '1',
                onchange: () => {
                    const number = Math.min(option.max, Math.max(option.min, Math.round(Number(input.value) || option.default)));
                    input.value = String(number);
                    set(number);
                },
            });
            input.value = String(value);
            return element('div', { className: 'option' }, element('label', { className: 'title', for: id, text: option.title }), input, hint);
        }
        case 'choice': {
            const select = element('select', { id, onchange: () => set(select.value) });
            for (const [key, label] of Object.entries(option.choices)) select.append(element('option', { value: key, text: label }));
            select.value = value;
            return element('div', { className: 'option' }, element('label', { className: 'title', for: id, text: option.title }), select, hint);
        }
        case 'list': {
            const area = element('textarea', {
                id, spellcheck: 'false',
                oninput: () => set(area.value.split('\n').map((line) => line.trim()).filter(Boolean)),
            });
            area.value = value.join('\n');
            const control = element('div', { className: 'option' }, element('label', { className: 'title', for: id, text: option.title }), area, hint);
            if (patch.id === 'handleCustomLinks') control.append(hostAccess(area));
            return control;
        }
        default:
            return null;
    }
}

/** Redirecting a host needs access to it; asks for the hosts not already allowed. */
function hostAccess(area) {
    const button = element('button', { type: 'button', className: 'secondary', text: 'Allow these hosts' });
    const note = element('p', { className: 'status' });
    const origins = () => area.value.split('\n').map((line) => line.trim().toLowerCase())
        .filter((host) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host))
        .flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]);
    button.addEventListener('click', async () => {
        const granted = await browser.permissions.request({ origins: origins() });
        note.textContent = granted ? 'Access granted.' : 'Access was not granted; links to those hosts stay where they are.';
    });
    return element('div', {}, element('div', { className: 'buttons' }, button), note);
}

function patchCard(patch) {
    const toggle = element('input', { type: 'checkbox', 'aria-label': `Enable ${patch.name}` });
    toggle.checked = settings.patches[patch.id];

    const card = element('div', { className: 'card', id: `patch-${patch.id}` });
    toggle.addEventListener('change', () => {
        settings.patches[patch.id] = toggle.checked;
        card.classList.toggle('off', !toggle.checked);
        save();
        renderTools();
    });
    card.classList.toggle('off', !toggle.checked);

    card.append(element('div', { className: 'head' },
        element('div', {}, element('h3', { text: patch.name }), element('p', { className: 'desc', text: patch.description })),
        element('label', { className: 'switch' }, toggle, element('span'))));

    if (patch.options?.length) {
        const options = element('div', { className: 'options' });
        for (const option of patch.options) options.append(optionControl(patch, option));
        card.append(options);
    }
    return card;
}

function render() {
    const main = document.getElementById('patches');
    const nav = document.getElementById('groups');
    main.replaceChildren();
    nav.replaceChildren();

    for (const group of catalogue.GROUPS) {
        const patches = catalogue.PATCHES.filter((patch) => patch.group === group.id);
        if (!patches.length) continue;
        nav.append(element('a', { href: `#group-${group.id}`, text: group.title }));
        const section = element('section', { className: 'group', id: `group-${group.id}` }, element('h2', { text: group.title }));
        for (const patch of patches) section.append(patchCard(patch));
        main.append(section);
    }
    nav.append(element('a', { href: '#tools', text: 'Tools' }));
    renderTools();
}

function renderTools() {
    const login = settings.patches.loginToken;
    const cache = settings.patches.deleteFromDatabase;
    document.getElementById('login-tools').hidden = !login;
    document.getElementById('cache-tools').hidden = !cache;
    document.getElementById('tools').hidden = !login && !cache;
}

// endregion

// region Tools

async function call(message) {
    const result = await browser.runtime.sendMessage(message);
    if (result?.error) throw new Error(result.error);
    return result;
}

document.getElementById('login-export').addEventListener('click', async () => {
    try {
        const { text } = await call({ type: 'exportLogin' });
        document.getElementById('login-text').value = text;
        status('login-status', 'Exported. Keep it private.');
    } catch (error) {
        status('login-status', error.message, true);
    }
});

document.getElementById('login-copy').addEventListener('click', async () => {
    const text = document.getElementById('login-text').value;
    if (!text) return status('login-status', 'Nothing to copy.', true);
    await navigator.clipboard.writeText(text);
    status('login-status', 'Copied.');
});

document.getElementById('login-import').addEventListener('click', async () => {
    const text = document.getElementById('login-text').value.trim();
    if (!text) return status('login-status', 'Paste an exported login first.', true);
    try {
        await call({ type: 'importLogin', text });
        document.getElementById('login-text').value = '';
        status('login-status', 'Imported. Reload x.com.');
    } catch (error) {
        status('login-status', error.message, true);
    }
});

document.getElementById('clear-cache').addEventListener('click', async () => {
    try {
        await call({ type: 'clearCache' });
        status('cache-status', 'Cleared. Reload x.com.');
    } catch (error) {
        status('cache-status', error.message, true);
    }
});

document.getElementById('reset').addEventListener('click', async () => {
    settings = catalogue.defaults();
    await browser.storage.local.set({ settings });
    render();
    status('save-status', 'Reset to defaults.');
});

// endregion

load().then(render);
