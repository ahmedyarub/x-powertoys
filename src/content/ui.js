/*
 * The patches that add to the page: actions in a post's "..." and share menus, options hidden
 * from the "..." menu, download buttons, dialogs, the home tabs and the remembered home position.
 */
(function () {
    'use strict';

    const XPT = globalThis.XPT;

    const ICONS = {
        download: 'M11 3h2v10.59l3.3-3.3 1.4 1.42L12 17.41l-5.7-5.7 1.4-1.42 3.3 3.3V3zM4 19h16v2H4z',
        link: 'M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a3 3 0 1 1 4.2 4.2l-2 2-1.4-1.4 2-2a1 1 0 1 0-1.4-1.4L12 13.4a1 1 0 0 1-1.4 0zm2.8-2.8a1 1 0 0 1 0 1.4l-3.5 3.5a3 3 0 1 1-4.2-4.2l2-2 1.4 1.4-2 2a1 1 0 1 0 1.4 1.4l3.5-3.5a1 1 0 0 1 1.4 0z',
        open: 'M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
        reader: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h14V5H5zm2 2h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z',
        translate: 'M4 5h7V3h2v2h3v2h-1.6a13 13 0 0 1-2.6 5.2l2.4 2.4-1.4 1.4-2.4-2.4A13 13 0 0 1 5.9 16l-.8-1.8a11 11 0 0 0 4.1-2.6A13 13 0 0 1 7.4 8h2.1a11 11 0 0 0 1.1 2.1A11 11 0 0 0 12.4 7H4V5zm12 6h2l4 10h-2.2l-.8-2h-4l-.8 2H12l4-10zm1 2.9L15.8 17h2.4L17 13.9z',
        code: 'M8.6 16.6 4 12l4.6-4.6L10 8.8 6.8 12l3.2 3.2-1.4 1.4zm6.8 0L14 15.2l3.2-3.2L14 8.8l1.4-1.4L20 12l-4.6 4.6z',
        keywords: 'M4 4h16v2h-7v14h-2V6H4V4z',
        filter: 'M3 4h18v2l-7 7v6l-4 2v-8L3 6V4z',
        image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v10.6l3.5-3.5 3 3 4.5-4.5 3 3V5H5zm0 14h14v-1.6l-3-3-4.5 4.5-3-3L5 18.4V19zM9 7.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
    };

    // region Helpers

    function svgIcon(path) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', path);
        svg.appendChild(shape);
        return svg;
    }

    function isDark() {
        const color = getComputedStyle(document.body || document.documentElement).backgroundColor;
        const rgb = (color.match(/\d+/g) || [255, 255, 255]).map(Number);
        return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128;
    }

    /** The id of the post an article shows: its timestamp links to it. */
    function postIdOf(article) {
        for (const anchor of article.querySelectorAll('a[href*="/status/"]')) {
            if (!anchor.querySelector('time')) continue;
            const match = anchor.getAttribute('href').match(/\/status\/(\d+)/);
            if (match) return match[1];
        }
        return pagePostId();
    }

    function pagePostId() {
        const match = location.pathname.match(/\/status\/(\d+)/);
        return match ? match[1] : null;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    function postUrl(post) {
        return `https://x.com/${post.screenName || 'i'}/status/${post.id}`;
    }

    /** A post with media of its own, or the post it quotes when it has none. */
    async function postWithMedia(id) {
        const { post } = await XPT.getPost(id);
        if (!post) return null;
        if (post.media.length) return post;
        for (const other of [post.retweetedId, post.quotedId]) {
            if (!other) continue;
            const { post: related } = await XPT.getPost(other);
            if (related?.media.length) return related;
        }
        return post;
    }

    // endregion

    // region Toasts and dialogs

    function overlayHost() {
        const host = document.createElement('div');
        host.className = 'xpt-host';
        const shadow = host.attachShadow({ mode: 'open' });
        const dark = isDark();
        const style = document.createElement('style');
        style.textContent = `
            :host { all: initial; }
            * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
            .toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 2147483647;
                padding: 12px 16px; border-radius: 8px; background: #1d9bf0; color: #fff; font-size: 15px; line-height: 20px;
                box-shadow: 0 4px 16px rgba(0,0,0,.3); max-width: calc(100vw - 32px); }
            .backdrop { position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center;
                background: ${dark ? 'rgba(91,112,131,.4)' : 'rgba(0,0,0,.4)'}; padding: 16px; }
            .panel { width: min(600px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; border-radius: 16px;
                background: ${dark ? '#000' : '#fff'}; color: ${dark ? '#e7e9ea' : '#0f1419'};
                box-shadow: ${dark ? '0 0 0 1px #2f3336, ' : ''}0 8px 28px rgba(0,0,0,.25); }
            .title { padding: 16px 20px 8px; font-size: 20px; font-weight: 800; }
            .note { padding: 0 20px 8px; font-size: 14px; color: #71767b; }
            .body { padding: 8px 20px; overflow: auto; flex: 1; }
            .text { white-space: pre-wrap; word-break: break-word; user-select: text; font-size: 15px; line-height: 22px; margin: 0; }
            .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 18px; }
            textarea { width: 100%; min-height: 140px; padding: 10px; border-radius: 6px; font-size: 15px; resize: vertical;
                background: transparent; color: inherit; border: 1px solid ${dark ? '#333639' : '#cfd9de'}; }
            label.row { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 15px; }
            .buttons { display: flex; justify-content: flex-end; gap: 12px; padding: 12px 20px 16px; flex-wrap: wrap; }
            button { border: 0; border-radius: 999px; padding: 8px 18px; font-size: 15px; font-weight: 700; cursor: pointer; }
            .primary { background: ${dark ? '#eff3f4' : '#0f1419'}; color: ${dark ? '#0f1419' : '#fff'}; }
            .secondary { background: transparent; color: inherit; box-shadow: inset 0 0 0 1px ${dark ? '#536471' : '#cfd9de'}; }
            img.preview { max-width: 100%; border-radius: 12px; display: block; margin: 0 auto; }
            a { color: #1d9bf0; }
        `;
        shadow.appendChild(style);
        (document.body || document.documentElement).appendChild(host);
        return { host, shadow };
    }

    function toast(text, ms = 3000) {
        const { host, shadow } = overlayHost();
        const box = document.createElement('div');
        box.className = 'toast';
        box.setAttribute('role', 'status');
        box.textContent = text;
        shadow.appendChild(box);
        setTimeout(() => host.remove(), ms);
    }

    /**
     * A modal dialog. content is a node; buttons are [{ label, primary?, action? }] and an action
     * returning false keeps the dialog open.
     */
    function dialog({ title, note, content, buttons }) {
        const { host, shadow } = overlayHost();
        const backdrop = document.createElement('div');
        backdrop.className = 'backdrop';
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', title);

        const heading = document.createElement('div');
        heading.className = 'title';
        heading.textContent = title;
        panel.appendChild(heading);

        if (note) {
            const noteBox = document.createElement('div');
            noteBox.className = 'note';
            noteBox.textContent = note;
            panel.appendChild(noteBox);
        }

        const body = document.createElement('div');
        body.className = 'body';
        body.appendChild(content);
        panel.appendChild(body);

        const close = () => {
            host.remove();
            document.removeEventListener('keydown', onKey, true);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener('keydown', onKey, true);

        const row = document.createElement('div');
        row.className = 'buttons';
        for (const button of buttons) {
            const element = document.createElement('button');
            element.type = 'button';
            element.className = button.primary ? 'primary' : 'secondary';
            element.textContent = button.label;
            element.addEventListener('click', async () => {
                const keep = button.action ? await button.action() : undefined;
                if (keep !== false) close();
            });
            row.appendChild(element);
        }
        panel.appendChild(row);

        backdrop.appendChild(panel);
        backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) close();
        });
        // Keys typed in the dialog stay out of the site's shortcuts.
        for (const type of ['keydown', 'keyup', 'keypress']) {
            panel.addEventListener(type, (event) => {
                if (event.key !== 'Escape') event.stopPropagation();
            });
        }
        shadow.appendChild(backdrop);
        return { close, shadow };
    }

    function textDialog(title, text, mono = false) {
        const pre = document.createElement('pre');
        pre.className = mono ? 'text mono' : 'text';
        pre.textContent = text;
        dialog({
            title,
            content: pre,
            buttons: [
                { label: 'Close' },
                { label: 'Copy', primary: true, action: async () => toast((await copyText(text)) ? 'Copied' : 'Could not copy') },
            ],
        });
    }

    // endregion

    // region Menus

    /** The last "..." or share button pressed on a post, which the next menu belongs to. */
    let opener = null;

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const caret = target.closest('article[data-testid="tweet"] [data-testid="caret"]');
        const share = !caret && target.closest('[role="group"] button[aria-haspopup="menu"]:not([data-testid])');
        if (!caret && !share) return;

        const article = (caret || share).closest('article');
        const id = article ? postIdOf(article) : pagePostId();
        if (id) opener = { kind: caret ? 'caret' : 'share', id, at: Date.now() };
    }, true);

    /** Closes the site's open menus: they close on a press outside them. */
    function closeMenus() {
        const x = 2;
        const y = window.innerHeight - 2;
        const target = document.elementFromPoint(x, y);
        if (!target || !target.closest('#layers')) return;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const Event = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
        }
    }

    function menuItem(menu, label, icon, action) {
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const template = items.find((item) => item.tagName === 'DIV') || items[0];
        if (!template) return null;

        const item = template.cloneNode(true);
        for (const attribute of ['data-testid', 'href', 'target', 'rel']) item.removeAttribute(attribute);
        item.dataset.xptItem = '1';
        item.setAttribute('role', 'menuitem');
        item.tabIndex = 0;

        const texts = [...item.querySelectorAll('span')].filter((span) => !span.children.length && span.textContent.trim());
        if (texts.length) {
            texts[0].textContent = label;
            for (const span of texts.slice(1)) span.textContent = '';
        } else {
            item.textContent = label;
        }

        const svg = item.querySelector('svg');
        if (svg) {
            const replacement = svgIcon(icon);
            replacement.setAttribute('class', svg.getAttribute('class') || '');
            svg.replaceWith(replacement);
        }

        const run = (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenus();
            Promise.resolve(action()).catch((error) => {
                console.warn('[X Power Toys] Action failed', error);
                toast(`Failed: ${error?.message || error}`);
            });
        };
        item.addEventListener('click', run, true);
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') run(event);
        }, true);
        return item;
    }

    function appendItems(menu, items) {
        const existing = [...menu.querySelectorAll('[role="menuitem"]')];
        let anchor = existing[existing.length - 1];
        if (!anchor) return;
        for (const item of items) {
            if (!item) continue;
            anchor.after(item);
            anchor = item;
        }
    }

    /** The Custom share menu key of a "..." menu option. English text only where nothing else names it. */
    function optionKey(item) {
        const testid = item.dataset.testid || '';
        const href = item.getAttribute('href') || '';
        const text = (item.innerText || '').trim();

        if (testid === 'block') return 'Block';
        if (testid === 'report') return 'Report';
        if (testid === 'tweetEngagements') return 'ViewEngagements';
        if (testid === 'whyThisAd') return 'WhyThisAd';
        if (href.includes('/i/lists/add_member')) return 'AddToList';
        if (href.includes('/i/communitynotes/noterequest')) return 'RequestCommunityNote';
        if (href.includes('quick_promote') || /^(?:Promote|Boost)\b/.test(text)) return 'Promote';
        if (/^Not interested/.test(text)) return 'NotInterested';
        if (/^(?:Follow|Unfollow) @/.test(text)) return 'Follow';
        if (/^(?:Mute|Unmute)\b/.test(text)) return 'Mute';
        if (/^Embed/.test(text)) return 'Embed';
        if (/^(?:Pin|Unpin)\b/.test(text)) return 'Pin';
        if (/Highlights?$|^Highlight\b/.test(text)) return 'Highlight';
        return null;
    }

    function processCaretMenu(menu, id) {
        const hidden = new Set(XPT.on('customShareMenu') ? (XPT.opt('customShareMenu', 'hiddenOptions') || []).map((key) => key.trim()) : []);
        if (XPT.on('hidePromoteButton')) hidden.add('Promote');
        for (const item of menu.querySelectorAll('[role="menuitem"]')) {
            const key = optionKey(item);
            if (key && hidden.has(key)) item.style.setProperty('display', 'none', 'important');
        }

        const actions = [];
        if (XPT.on('copyMediaLink')) actions.push(['Copy media link', ICONS.link, () => copyMediaLinks(id)]);
        if (XPT.on('externalDownloader')) actions.push(['Open in downloader', ICONS.open, () => openInDownloader(id)]);
        if (XPT.on('readerMode')) actions.push(['Reader mode', ICONS.reader, () => readerMode(id)]);
        if (XPT.on('nativeTranslator')) actions.push(['Translate with Google', ICONS.translate, () => translate(id)]);
        if (XPT.on('postDebugMenu')) actions.push(['Post data', ICONS.code, () => postData(id)]);
        if (XPT.on('filterByKeyword')) actions.push(['Filtered keywords', ICONS.keywords, editKeywords]);
        if (XPT.on('feedFilters')) actions.push(['Feed filters', ICONS.filter, editFeedFilters]);
        appendItems(menu, actions.map(([label, icon, action]) => menuItem(menu, label, icon, action)));
    }

    function processShareMenu(menu, id) {
        const actions = [];
        if (XPT.on('shareAsImage')) actions.push(['Share as image', ICONS.image, () => shareAsImage(id)]);
        if (XPT.on('nativeDownloader')) actions.push(['Download media', ICONS.download, () => downloadMedia(id)]);
        appendItems(menu, actions.map(([label, icon, action]) => menuItem(menu, label, icon, action)));
    }

    function processMenus() {
        for (const menu of document.querySelectorAll('[role="menu"]:not([data-xpt-menu])')) {
            // The menu is laid out before its options are; wait for them.
            if (!menu.querySelector('[role="menuitem"]')) continue;
            menu.dataset.xptMenu = '1';
            if (!opener || Date.now() - opener.at > 3000) continue;

            const { kind, id } = opener;
            opener = null;
            if (kind === 'caret') processCaretMenu(menu, id);
            else processShareMenu(menu, id);
        }
    }

    // endregion

    // region Actions

    async function copyMediaLinks(id) {
        const post = await postWithMedia(id);
        if (!post) return toast('This post is not loaded yet. Scroll it into view and try again.');
        if (!post.media.length) return toast('This post has no media');

        const links = post.media.map((item) => item.url).join('\n');
        if (!(await copyText(links))) return textDialog('Media links', links);
        toast(post.media.length === 1 ? 'Media link copied' : `${post.media.length} media links copied`);
    }

    async function openInDownloader(id) {
        const { post } = await XPT.getPost(id);
        const url = post ? postUrl(post) : `https://x.com/i/status/${id}`;
        const template = (XPT.opt('externalDownloader', 'urlTemplate') || '').trim();

        if (template && /^https?:\/\//i.test(template)) {
            window.open(template.replaceAll('{url}', encodeURIComponent(url)), '_blank', 'noopener');
        } else if (navigator.share) {
            await navigator.share({ url }).catch(() => {});
        } else {
            toast((await copyText(url)) ? 'Post link copied for your downloader' : url, 4000);
        }
    }

    async function readerMode(id) {
        const { post } = await XPT.getPost(id);
        if (!post) return toast('This post is not loaded yet. Scroll it into view and try again.');

        const withMedia = await postWithMedia(id);
        let page = post.text;
        const media = withMedia?.media || [];
        if (media.length) page += '\n\n' + media.map((item) => item.url).join('\n');
        textDialog('Reader mode', `${post.name} @${post.screenName}\n\n${page}`.trim());
    }

    async function translate(id) {
        const { post } = await XPT.getPost(id);
        if (!post) return toast('This post is not loaded yet. Scroll it into view and try again.');

        const target = (navigator.language || 'en').split('-')[0];
        const url = new URL('https://translate.google.com/');
        url.searchParams.set('sl', 'auto');
        url.searchParams.set('tl', target);
        url.searchParams.set('op', 'translate');
        url.searchParams.set('text', post.text);
        window.open(url.toString(), '_blank', 'noopener');
    }

    async function postData(id) {
        const { post, raw } = await XPT.getPost(id, true);
        if (!post) return toast('This post is not loaded yet. Scroll it into view and try again.');
        textDialog('Post data', JSON.stringify(raw ?? post, null, 2), true);
    }

    async function downloadMedia(id) {
        const post = await postWithMedia(id);
        if (!post) return toast('This post is not loaded yet. Scroll it into view and try again.');
        if (!post.media.length) return toast('This post has no media');

        const several = post.media.length > 1;
        const items = post.media.map((item, index) => ({
            url: item.url,
            filename: `${post.screenName || 'x'}_${post.id}${several ? `_${index + 1}` : ''}.${item.ext}`,
        }));
        const result = await XPT.background({ type: 'download', items });
        if (result?.error) return toast(`Download failed: ${result.error}`, 5000);
        toast(several ? `Downloading ${items.length} files` : 'Downloading');
    }

    async function shareAsImage(id) {
        const { post } = await XPT.getPost(id);
        if (!post) return toast('This post is not loaded yet. Scroll it into view and try again.');

        const blob = await XPT.renderCard(post, isDark());
        const url = URL.createObjectURL(blob);
        const image = document.createElement('img');
        image.className = 'preview';
        image.src = url;
        image.alt = 'The post as an image';

        const filename = `${post.screenName || 'x'}_${post.id}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        const buttons = [{ label: 'Close' }];
        if (navigator.canShare?.({ files: [file] })) {
            buttons.push({ label: 'Share', action: () => navigator.share({ files: [file] }).catch(() => {}) });
        }
        buttons.push({
            label: 'Copy',
            action: async () => {
                try {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    toast('Image copied');
                } catch {
                    toast('Could not copy the image; download it instead');
                    return false;
                }
            },
        });
        buttons.push({
            label: 'Download',
            primary: true,
            action: async () => {
                const dataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
                const result = await XPT.background({ type: 'downloadData', dataUrl, filename });
                toast(result?.error ? `Download failed: ${result.error}` : 'Downloading');
            },
        });

        const { shadow } = dialog({ title: 'Share as image', content: image, buttons });
        // The object URL lives as long as the dialog.
        new MutationObserver((_, observer) => {
            if (!shadow.host.isConnected) {
                URL.revokeObjectURL(url);
                observer.disconnect();
            }
        }).observe(document.body || document.documentElement, { childList: true });
    }

    function editKeywords() {
        const area = document.createElement('textarea');
        area.placeholder = 'One keyword or phrase per line';
        area.value = (XPT.opt('filterByKeyword', 'keywords') || []).join('\n');
        dialog({
            title: 'Filtered keywords',
            note: 'Posts containing any of these are hidden from timelines as they load.',
            content: area,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Save',
                    primary: true,
                    action: async () => {
                        await XPT.saveOptions('filterByKeyword', { keywords: lines(area.value) });
                        toast('Saved. Refreshing…');
                    },
                },
            ],
        });
        setTimeout(() => area.focus(), 0);
    }

    function editFeedFilters() {
        const content = document.createElement('div');
        const toggles = {};
        for (const [key, label] of [
            ['mediaOnly', 'Media only (photos, videos, GIFs)'],
            ['hideFollowed', 'Hide followed profiles'],
            ['hideSuggested', 'Hide suggested accounts and communities'],
        ]) {
            const row = document.createElement('label');
            row.className = 'row';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = XPT.opt('feedFilters', key) === true;
            toggles[key] = box;
            row.append(box, label);
            content.appendChild(row);
        }
        const include = document.createElement('textarea');
        include.placeholder = 'Include keywords: when set, only posts containing one of these are shown';
        include.value = (XPT.opt('feedFilters', 'includeKeywords') || []).join('\n');
        content.appendChild(include);

        dialog({
            title: 'Feed filters',
            content,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Save',
                    primary: true,
                    action: async () => {
                        await XPT.saveOptions('feedFilters', {
                            mediaOnly: toggles.mediaOnly.checked,
                            hideFollowed: toggles.hideFollowed.checked,
                            hideSuggested: toggles.hideSuggested.checked,
                            includeKeywords: lines(include.value),
                        });
                        toast('Saved. Refreshing…');
                    },
                },
            ],
        });
    }

    function lines(text) {
        return text.split('\n').map((line) => line.trim()).filter(Boolean);
    }

    // endregion

    // region Download buttons

    const MEDIA = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="previewInterstitial"]';

    function decorateActionBars() {
        if (!XPT.on('nativeDownloader')) return;

        for (const bar of document.querySelectorAll('article[data-testid="tweet"] [role="group"]:not([data-xpt-bar])')) {
            if (!bar.querySelector('[data-testid="reply"]')) continue;
            const article = bar.closest('article');
            if (!article.querySelector(MEDIA)) continue;

            bar.dataset.xptBar = '1';
            const wrapper = document.createElement('div');
            wrapper.className = 'xpt-action';
            const button = document.createElement('button');
            button.type = 'button';
            button.title = 'Download media';
            button.setAttribute('aria-label', 'Download media');
            button.appendChild(svgIcon(ICONS.download));
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = postIdOf(article);
                if (id) downloadMedia(id).catch((error) => toast(`Download failed: ${error?.message || error}`));
            });
            wrapper.appendChild(button);
            bar.appendChild(wrapper);
        }
    }

    // endregion

    // region Follow, Not interested and Block buttons

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /** Actions in flight waiting for the server: follows and blocks by user id, feedback in order. */
    const waits = { follow: new Map(), block: new Map(), feedback: [] };

    function wantsPostActions() {
        return XPT.on('followButton') ||
            (XPT.on('postActionButtons') && (XPT.opt('postActionButtons', 'showNotInterested') || XPT.opt('postActionButtons', 'showBlock')));
    }

    function decoratePostActions() {
        if (!wantsPostActions()) return;

        for (const article of document.querySelectorAll('article[data-testid="tweet"]:not([data-xpt-actions])')) {
            const name = article.querySelector('[data-testid="User-Name"]');
            const id = name && postIdOf(article);
            if (!id) continue;
            article.dataset.xptActions = 'pending';

            XPT.getPost(id).then(({ post }) => {
                article.dataset.xptActions = 'done';
                if (!post || !post.author.id) return;
                article.dataset.xptAuthor = post.author.id;
                renderPostActions(article, name, post);
            });
        }
    }

    /** The buttons next to the author's name, for what the post's author can still be done with. */
    function renderPostActions(article, name, post) {
        name.querySelector('.xpt-actions')?.remove();
        if (post.isViewer) return;

        const { author } = post;
        const bar = document.createElement('span');
        bar.className = `xpt-actions ${isDark() ? 'xpt-actions-dark' : 'xpt-actions-light'}`;

        if (XPT.on('followButton') && post.followState === 'none' && !author.blocking && !author.blockedBy) {
            bar.append(actionButton('Follow', `Follow @${post.screenName}`, 'xpt-follow', () => follow(article, post)));
        }
        if (XPT.on('postActionButtons')) {
            if (XPT.opt('postActionButtons', 'showNotInterested') && post.takesFeedback) {
                bar.append(actionButton('Not interested', 'Not interested in this post', 'xpt-chip', (button) => notInterested(article, post, button)));
            }
            if (XPT.opt('postActionButtons', 'showBlock') && !author.blocking) {
                bar.append(actionButton('Block', `Block @${post.screenName}`, 'xpt-chip xpt-chip-danger', () => block(article, post)));
            }
        }
        if (bar.children.length) name.firstElementChild?.after(bar);
    }

    function actionButton(label, description, className, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.title = description;
        button.setAttribute('aria-label', description);

        // The post opens on a press anywhere in it; this one is the button's alone.
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            button.addEventListener(type, (event) => event.stopPropagation());
        }
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) return;

            button.disabled = true;
            try {
                await action(button);
            } catch (error) {
                // Gone already: what it did shows in its place.
                if (button.isConnected && error?.message) toast(error.message, 4000);
            } finally {
                // Still here: the action was not confirmed.
                if (button.isConnected) button.disabled = false;
            }
        });
        return button;
    }

    /**
     * Picks an option from the post's own menu, kept out of sight, so the site does what it does
     * for that option. pick gets the menu's options once they are there.
     */
    async function useMenuOption(article, pick, what) {
        const caret = article.querySelector('[data-testid="caret"]');
        if (!caret) throw new Error(`This post has no menu to ${what} from`);

        document.documentElement.classList.add('xpt-quiet');
        try {
            caret.click();
            let item = null;
            for (let tries = 0; tries < 30 && !item; tries++) {
                await sleep(50);
                const options = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].filter((option) => !option.dataset.xptItem);
                if (options.length) item = pick(options);
            }
            if (!item) {
                closeMenus();
                throw new Error(`Could not find ${what} in the post menu`);
            }
            item.click();
        } finally {
            document.documentElement.classList.remove('xpt-quiet');
        }
    }

    function untilConfirmed(promise, ms) {
        return Promise.race([promise, sleep(ms).then(() => null)]);
    }

    /** Follows the author; the button goes when the server confirms the follow, not before. */
    async function follow(article, post) {
        const confirmed = new Promise((resolve) => waits.follow.set(post.author.id, resolve));
        const handle = `@${post.screenName}`.toLowerCase();
        try {
            await useMenuOption(article, (options) => options.find((option) =>
                !option.dataset.testid && !option.getAttribute('href') && (option.innerText || '').toLowerCase().includes(handle)),
            `Follow @${post.screenName}`);

            // Already followed after all: the site asks to confirm an unfollow. Say no.
            await sleep(300);
            const cancel = document.querySelector('[data-testid="confirmationSheetCancel"]');
            if (cancel) {
                cancel.click();
                throw new Error(`You already follow @${post.screenName}`);
            }
            if (!(await untilConfirmed(confirmed, 10000))) throw new Error(`X did not confirm following @${post.screenName}`);
        } finally {
            waits.follow.delete(post.author.id);
        }
    }

    /**
     * Not interested in this post: the menu's first option, which is that on every post but your
     * own. The site swaps the post for its own notice with Undo.
     */
    async function notInterested(article, post, button) {
        let settle;
        const confirmed = new Promise((resolve) => { settle = resolve; });
        waits.feedback.push(settle);
        const handle = `@${post.screenName}`.toLowerCase();
        try {
            await useMenuOption(article, (options) => {
                const first = options[0];
                const fits = first && !first.dataset.testid && !first.getAttribute('href') &&
                    !(first.innerText || '').toLowerCase().includes(handle);
                return fits ? first : null;
            }, 'Not interested');
            if (!(await untilConfirmed(confirmed, 10000)) && button.isConnected) {
                throw new Error('X did not confirm Not interested');
            }
        } finally {
            const index = waits.feedback.indexOf(settle);
            if (index >= 0) waits.feedback.splice(index, 1);
        }
    }

    /**
     * Blocks the author. The site asks Block @user? as it always does, unless that is turned off;
     * the buttons go when the server confirms the block, and stay when the question is declined.
     */
    async function block(article, post) {
        const confirmed = new Promise((resolve) => waits.block.set(post.author.id, resolve));
        try {
            await useMenuOption(article, (options) => options.find((option) => option.dataset.testid === 'block'), `Block @${post.screenName}`);

            await sleep(300);
            if (!XPT.opt('postActionButtons', 'confirmBlock')) {
                document.querySelector('[data-testid="confirmationSheetConfirm"]')?.click();
            }

            // Wait while X's question is open, then up to five seconds for the server's answer. No
            // answer means the question was declined or the block failed: the buttons stay.
            let closedAt = null;
            while (!(await untilConfirmed(confirmed, 250))) {
                if (document.querySelector('[data-testid="confirmationSheetDialog"]')) {
                    closedAt = null;
                    continue;
                }
                closedAt ??= Date.now();
                if (Date.now() - closedAt > 5000) return;
            }
        } finally {
            waits.block.delete(post.author.id);
        }
    }

    /** Shows the posts of an account anew after its follow or block state changed. */
    function refreshAuthor(userId) {
        for (const article of document.querySelectorAll(`article[data-xpt-author="${CSS.escape(userId)}"]`)) {
            delete article.dataset.xptActions;
        }
        schedule();
    }

    XPT.onOutcome('follow', ({ userId, state }) => {
        waits.follow.get(String(userId))?.(state);
        refreshAuthor(String(userId));
    });

    XPT.onOutcome('block', ({ userId, state }) => {
        waits.block.get(String(userId))?.(state);
        refreshAuthor(String(userId));
    });

    XPT.onOutcome('feedback', ({ undo }) => {
        if (!undo) waits.feedback.shift()?.(true);
    });

    // endregion

    // region Home tabs

    function homeTabs() {
        return [...document.querySelectorAll('[data-testid="primaryColumn"] [role="tablist"] [role="tab"]')];
    }

    /** When the selected home tab is hidden, switches to the first one shown. */
    function keepVisibleHomeTab() {
        if (!XPT.on('homeTabs') || currentPage !== 'home') return;

        const tabs = homeTabs();
        const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
        if (!selected || selected.getClientRects().length) return;

        const shown = tabs.find((tab) => tab.getClientRects().length);
        shown?.click();
    }

    // endregion

    // region Home position

    const POSITION_KEY = 'xpt:home-position:';
    let restoreState = 'pending';
    let lastSave = 0;

    function selectedHomeTab() {
        const tabs = homeTabs();
        const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
        return index < 0 ? null : { index, label: tabs[index].innerText.trim() };
    }

    function headerHeight() {
        const tablist = document.querySelector('[data-testid="primaryColumn"] [role="tablist"]');
        return tablist ? Math.max(0, tablist.getBoundingClientRect().bottom) : 0;
    }

    /** The first post fully below the header. */
    function topPost() {
        const top = headerHeight();
        for (const article of document.querySelectorAll('[data-testid="primaryColumn"] article[data-testid="tweet"]')) {
            if (article.getBoundingClientRect().top >= top - 1) return postIdOf(article);
        }
        return null;
    }

    function savePosition() {
        if (!XPT.on('disableAutoScroll') || currentPage !== 'home' || restoreState === 'running') return;
        if (Date.now() - lastSave < 1000) return;
        lastSave = Date.now();

        // For you is never restored, so its position is not kept.
        const tab = selectedHomeTab();
        const id = tab && tab.index > 0 && topPost();
        if (!id) return;
        try {
            localStorage.setItem(POSITION_KEY + tab.label, JSON.stringify({ id, at: Date.now() }));
        } catch {
            // Storage is full or blocked.
        }
    }

    /**
     * Once per visit, scrolls a home tab back to the post it was left at, loading more of the
     * timeline until the post shows up. For you is made anew each visit, so it starts at the top.
     */
    async function restorePosition() {
        if (restoreState !== 'pending' || !XPT.on('disableAutoScroll') || currentPage !== 'home') return;

        const tab = selectedHomeTab();
        if (!tab || !document.querySelector('[data-testid="primaryColumn"] article[data-testid="tweet"]')) return;
        restoreState = 'done';
        if (tab.index === 0) return;

        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(POSITION_KEY + tab.label) || 'null');
        } catch {
            return;
        }
        if (!saved?.id || Date.now() - saved.at > 7 * 24 * 3600 * 1000) return;

        restoreState = 'running';
        let cancelled = false;
        const cancel = () => { cancelled = true; };
        const events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
        for (const type of events) window.addEventListener(type, cancel, { capture: true, once: true, passive: true });

        const find = () => [...document.querySelectorAll('[data-testid="primaryColumn"] article[data-testid="tweet"]')]
            .find((article) => postIdOf(article) === saved.id);

        let found = null;
        for (let round = 0; round < 12 && !cancelled; round++) {
            found = find();
            if (found) break;
            window.scrollTo(0, document.documentElement.scrollHeight);
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }

        for (const type of events) window.removeEventListener(type, cancel, true);
        if (!cancelled) {
            if (found) {
                found.scrollIntoView({ block: 'start' });
                window.scrollBy(0, -headerHeight());
                toast('Back where you left off');
            } else {
                window.scrollTo(0, 0);
                toast('Could not find where you left off');
            }
        }
        restoreState = 'done';
    }

    window.addEventListener('scroll', () => savePosition(), { passive: true });

    // endregion

    // region Refresh on settings changes

    /**
     * Filters and other rewrites apply to what x.com downloads, so a change to one is shown by
     * loading the page anew. Changes come in bursts while settings are edited; the page waits for
     * them to settle, for the tab to be in view, and never drops text being written.
     */
    let refreshTimer = null;

    // Settings are saved with an explicit Save in the popup and the page's dialogs, so the page
    // refreshes at once; the short wait only folds the writes of one save into one refresh.
    XPT.onNeedsReload(() => {
        console.debug('[X Power Toys] A settings change needs the page refreshed');
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refreshWhenShown, 150);
    });

    let waitingForView = false;
    function refreshWhenShown() {
        if (!document.hidden) return refreshPage();
        if (waitingForView) return;
        waitingForView = true;
        console.debug('[X Power Toys] Refreshing once the tab is in view');
        document.addEventListener('visibilitychange', function onShown() {
            if (document.hidden) return;
            document.removeEventListener('visibilitychange', onShown);
            waitingForView = false;
            refreshPage();
        });
    }

    /** Text typed into a composer or any other field; placeholders and labels do not count. */
    function hasUnsentText() {
        const editable = [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')]
            .some((field) => field.textContent.trim());
        const typed = [...document.querySelectorAll('textarea, input[type="text"]:not([data-testid="SearchBox_Search_Input"])')]
            .some((field) => field.value.trim());
        return editable || typed;
    }

    function refreshPage() {
        if (!hasUnsentText()) {
            console.debug('[X Power Toys] Refreshing the page for the new settings');
            location.reload();
            return;
        }
        console.debug('[X Power Toys] Refresh postponed: there is unsent text');

        const { host, shadow } = overlayHost();
        const box = document.createElement('div');
        box.className = 'toast';
        box.setAttribute('role', 'status');
        box.style.cssText = 'display: flex; align-items: center; gap: 12px;';
        const label = document.createElement('span');
        label.textContent = 'Settings changed. Refresh to apply them once your post is sent.';
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'primary';
        refresh.textContent = 'Refresh';
        refresh.addEventListener('click', () => location.reload());
        const later = document.createElement('button');
        later.type = 'button';
        later.className = 'secondary';
        later.textContent = 'Later';
        later.addEventListener('click', () => host.remove());
        box.append(label, refresh, later);
        shadow.appendChild(box);
    }

    // endregion

    // region Page tracking

    let currentPage = null;

    function trackPage() {
        const path = location.pathname;
        const page = path === '/home' ? 'home' : /\/status\/\d+/.test(path) ? 'status' : 'other';
        if (page !== currentPage) {
            currentPage = page;
            document.documentElement.dataset.xptPage = page;
        }
    }

    let scheduled = false;
    function scan() {
        scheduled = false;
        trackPage();
        processMenus();
        decorateActionBars();
        decoratePostActions();
        keepVisibleHomeTab();
        restorePosition();
        for (const scanner of XPT.scanners) {
            try {
                scanner();
            } catch (error) {
                console.warn('[X Power Toys] Scan failed', error);
            }
        }
    }

    // What the other content scripts share: helpers, and scanners run with every page change.
    XPT.ui = { postIdOf, pagePostId, svgIcon };
    XPT.scanners = [];

    // A timer rather than an animation frame: frames do not run in a tab opened in the background.
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(scan, 30);
    }

    trackPage();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', schedule);
    XPT.onChange(schedule);

    // endregion
})();
