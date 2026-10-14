/*
 * Inline replies: a post's replies open right below it in the timeline, without leaving the page
 * or opening a dialog, as a tree: each reply sits under the one it answers, indented a level.
 *
 * Show replies loads the post's first page. Every reply with replies of its own can open them
 * under it, any number of levels down; Load more, Show more replies and Expand all load the rest,
 * Expand all opening the replies shown before the next page, up to the configured number of
 * replies. What was loaded stays when the post scrolls away and is shown again when it comes back.
 */
(function () {
    'use strict';

    const XPT = globalThis.XPT;
    const T = globalThis.XPT_REPLY_TREE;
    const { postIdOf, pagePostId, svgIcon } = XPT.ui;

    const ICONS = {
        reply: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h2v2l2.5-2H20V6H4z',
        repost: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
        like: 'M12 21s-7-4.35-9.5-8.5C.9 9.6 2.6 5.5 6.5 5.5c2 0 3.5 1.2 5.5 3.3 2-2.1 3.5-3.3 5.5-3.3 3.9 0 5.6 4.1 4 7-2.5 4.15-9.5 8.5-9.5 8.5zm0-2.4c2.2-1.5 6.2-4.5 7.8-7.2 1-1.8.1-4.4-2.3-4.4-1.3 0-2.4.9-4.5 3.1L12 11.1l-1-1.1C8.9 7.8 7.8 6.9 6.5 6.9c-2.4 0-3.3 2.6-2.3 4.4 1.6 2.7 5.6 5.7 7.8 7.3z',
    };

    const IMAGE_HOST = /^https:\/\/pbs\.twimg\.com\//;
    /** Levels indented; deeper replies line up with the last indented level. */
    const MAX_INDENT = 5;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /** What is known of each post's replies, by post id. */
    const conversations = new Map();

    function conversation(post) {
        let state = conversations.get(post.id);
        if (!state) {
            state = {
                post,
                tree: T.createConversation(post),
                open: false,
                busy: false,
                error: null,
                limitReached: false,
                version: 0,
                boxes: new Set(),
            };
            conversations.set(post.id, state);
        }
        return state;
    }

    // region Loading

    /** Loads one piece of work from the tree: a page of a conversation or the rest of a thread. */
    async function load(state, work) {
        if (work.kind === 'thread') state.tree.threadCursors.delete(work.id);
        const { conversation: answer, error } = await XPT.getConversation(work.source, work.cursor);
        if (error) {
            if (work.kind === 'thread') state.tree.threadCursors.set(work.id, { source: work.source, cursor: work.cursor });
            throw new Error(error);
        }
        return T.merge(state.tree, work.source, answer, work.kind === 'page' ? work.cursor : null);
    }

    /** Runs one loading step with the busy state and errors shown. */
    async function run(state, step) {
        if (state.busy) return;
        state.busy = true;
        state.error = null;
        update(state);
        try {
            await step();
        } catch (error) {
            state.error = error.message;
        } finally {
            state.busy = false;
            update(state);
        }
    }

    function rootStarted(state) {
        return Boolean(state.tree.sources.get(state.post.id)?.started);
    }

    function showReplies(state) {
        state.open = !state.open;
        if (state.open && !rootStarted(state)) {
            run(state, () => load(state, { kind: 'page', id: state.post.id, source: state.post.id, cursor: null }));
        } else {
            update(state);
        }
    }

    /** The post's own next page of replies. */
    function loadMore(state) {
        const page = T.moreAt(state.tree, state.post.id).find((work) => work.kind === 'page' && work.cursor);
        if (page) run(state, () => load(state, page));
    }

    /** Branches loaded side by side by Expand all; more would draw X's request limits sooner. */
    const PARALLEL = 3;

    /**
     * Loads the replies until there are no more or the limit is reached: a few branches at a time,
     * a pause between rounds.
     */
    function expandAll(state) {
        const limit = Number(XPT.opt('inlineReplies', 'maxReplies')) || 100;
        run(state, async () => {
            let idle = 0;
            while (state.tree.loaded < limit && idle < 10) {
                const works = T.nextWorks(state.tree, PARALLEL);
                if (!works.length) break;
                const results = await Promise.allSettled(works.map((work) => load(state, work)));
                const failure = results.find((result) => result.status === 'rejected');
                if (failure) throw failure.reason;
                const added = results.reduce((sum, result) => sum + result.value, 0);
                idle = added ? 0 : idle + 1;
                update(state);
                await sleep(300);
            }
            state.limitReached = state.tree.loaded >= limit && T.nextWork(state.tree) !== null;
        });
    }

    // endregion

    // region Rendering

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** Moves to a page of the site the way its own links do, or lets the browser open a new tab. */
    function link(anchor, path) {
        anchor.href = path;
        anchor.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            history.pushState({}, '', path);
            window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        });
        return anchor;
    }

    function relativeTime(createdAt) {
        const date = new Date(createdAt);
        if (Number.isNaN(date.getTime())) return '';
        const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return `${Math.floor(seconds)}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: seconds > 300 * 86400 ? 'numeric' : undefined });
    }

    function count(number) {
        if (!number) return '';
        if (number < 1000) return String(number);
        if (number < 1e6) return `${(number / 1000).toFixed(number < 1e4 ? 1 : 0).replace(/\.0$/, '')}K`;
        return `${(number / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    }

    const TOKEN = /(https?:\/\/[^\s]+)|(@[A-Za-z0-9_]{1,15})|(#[\p{L}\p{N}_]+)/gu;

    /** A post's text with its links, mentions and hashtags clickable. */
    function richText(text) {
        const container = element('div', 'xpt-reply-text');
        let last = 0;
        for (const match of text.matchAll(TOKEN)) {
            container.append(text.slice(last, match.index));
            const [token, url, mention, hashtag] = match;
            const anchor = element('a', 'xpt-link', token);
            if (url) {
                anchor.href = url;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.addEventListener('click', (event) => event.stopPropagation());
            } else if (mention) {
                link(anchor, `/${mention.slice(1)}`);
            } else if (hashtag) {
                link(anchor, `/hashtag/${encodeURIComponent(hashtag.slice(1))}?src=hashtag_click`);
            }
            container.append(anchor);
            last = match.index + token.length;
        }
        container.append(text.slice(last));
        return container;
    }

    function replyNode(post) {
        const node = element('div', 'xpt-reply');
        const postPath = `/${post.screenName}/status/${post.id}`;

        const avatar = link(element('a', 'xpt-reply-avatar'), `/${post.screenName}`);
        if (IMAGE_HOST.test(post.avatar)) {
            const image = element('img');
            image.src = post.avatar;
            image.alt = '';
            image.loading = 'lazy';
            avatar.append(image);
        }

        const body = element('div', 'xpt-reply-body');
        const head = element('div', 'xpt-reply-head');
        head.append(link(element('a', 'xpt-reply-name', post.name || post.screenName), `/${post.screenName}`));
        head.append(element('span', 'xpt-muted', ` @${post.screenName} · `));
        head.append(link(element('a', 'xpt-muted xpt-reply-time', relativeTime(post.createdAt)), postPath));
        body.append(head);

        if (post.text) body.append(richText(post.text));

        if (post.media.length) {
            const media = element('div', `xpt-reply-media xpt-media-${Math.min(post.media.length, 4)}`);
            post.media.slice(0, 4).forEach((item, index) => {
                const path = item.type === 'photo' ? `${postPath}/photo/${index + 1}` : postPath;
                const tile = link(element('a', 'xpt-reply-tile'), path);
                if (IMAGE_HOST.test(item.preview)) {
                    const image = element('img');
                    image.src = item.preview;
                    image.alt = item.type === 'photo' ? 'Image' : 'Video';
                    image.loading = 'lazy';
                    tile.append(image);
                }
                if (item.type !== 'photo') tile.append(element('span', 'xpt-reply-play', '▶'));
                media.append(tile);
            });
            body.append(media);
        }

        const stats = element('div', 'xpt-reply-stats xpt-muted');
        const stat = (node, icon, number, label) => {
            node.append(svgIcon(icon), element('span', '', count(number)));
            node.title = `${number} ${label}`;
            return node;
        };
        stats.append(stat(link(element('a', 'xpt-muted xpt-reply-stat'), postPath), ICONS.reply, post.replyCount, 'replies'));
        stats.append(stat(element('span', 'xpt-reply-stat'), ICONS.repost, post.retweetCount, 'reposts'));
        stats.append(stat(element('span', 'xpt-reply-stat'), ICONS.like, post.likeCount, 'likes'));
        body.append(stats);

        node.append(avatar, body);
        // A press on the reply, outside its links, opens it.
        node.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.target.closest('a, button')) return;
            history.pushState({}, '', postPath);
            window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        });
        return node;
    }

    function button(label, action, disabled) {
        const node = element('button', 'xpt-replies-button', label);
        node.type = 'button';
        node.disabled = disabled;
        node.addEventListener('click', action);
        return node;
    }

    /** The buttons under a reply for what more it can load. */
    function moreButtons(state, more) {
        return more.map((work) => {
            const label = work.kind === 'thread'
                ? 'Show more replies'
                : work.first
                    ? `Show replies (${count(work.remaining) || work.remaining})`
                    : 'Load more replies';
            const node = button(label, () => run(state, () => load(state, work)), state.busy);
            node.classList.add('xpt-node-more');
            return node;
        });
    }

    /** A reply, then its replies indented under it, then what more it can load. */
    function subtree(state, tree, id, depth) {
        const node = element('div', 'xpt-node');
        node.append(replyNode(state.tree.posts.get(id)));

        const kids = tree.get(id) || [];
        const more = T.moreAt(state.tree, id, tree);
        if (kids.length || more.length) {
            const branch = element('div', depth < MAX_INDENT ? 'xpt-branch' : 'xpt-branch xpt-branch-flat');
            for (const kid of kids) branch.append(subtree(state, tree, kid, depth + 1));
            branch.append(...moreButtons(state, more));
            node.append(branch);
        }
        return node;
    }

    function buildBox(state) {
        const box = element('div', 'xpt-replies');
        box.dataset.for = state.post.id;

        // The cell opens the post on a press; presses in here are the box's own.
        for (const type of ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            box.addEventListener(type, (event) => event.stopPropagation());
        }

        const bar = element('div', 'xpt-replies-bar');
        const toggle = button('', () => showReplies(state), false);
        const more = button('Load more', () => loadMore(state), false);
        const all = button('Expand all', () => expandAll(state), false);
        const status = element('span', 'xpt-muted xpt-replies-status');
        status.setAttribute('role', 'status');
        bar.append(toggle, more, all, status);

        const list = element('div', 'xpt-replies-list');
        box.append(bar, list);
        box.xpt = { toggle, more, all, status, list, rendered: -1 };
        return box;
    }

    function renderBox(state, box) {
        const { toggle, more, all, status, list } = box.xpt;
        const total = state.post.replyCount;
        const started = rootStarted(state);
        const pending = started ? T.nextWork(state.tree) : null;
        const rootPage = started && T.moreAt(state.tree, state.post.id).some((work) => work.kind === 'page' && work.cursor);

        toggle.textContent = state.open ? 'Hide replies' : `Show replies${total ? ` (${count(total)})` : ''}`;
        more.hidden = !state.open || !rootPage;
        all.hidden = !state.open || !pending || state.limitReached;
        more.disabled = all.disabled = state.busy;

        const loaded = state.tree.loaded;
        if (state.busy) status.textContent = `${loaded ? `${loaded} · ` : ''}Loading…`;
        else if (state.error) status.textContent = state.error;
        else if (state.open && started) {
            status.textContent = `${loaded} ${loaded === 1 ? 'reply' : 'replies'}` +
                (state.limitReached ? ' · Expand all limit reached' : !pending ? ' · all loaded' : '');
        } else status.textContent = '';
        status.classList.toggle('xpt-error', Boolean(state.error));

        list.hidden = !state.open;
        if (!state.open || box.xpt.rendered === state.version) return;
        box.xpt.rendered = state.version;

        const tree = T.children(state.tree);
        list.replaceChildren();
        for (const id of tree.get(state.post.id) || []) {
            const thread = element('div', 'xpt-thread');
            thread.append(subtree(state, tree, id, 1));
            list.append(thread);
        }
        if (started && !loaded && !state.busy && !state.error) {
            list.append(element('div', 'xpt-muted xpt-replies-empty', 'No replies to show.'));
        }
    }

    function update(state) {
        state.version++;
        for (const box of state.boxes) {
            if (!box.isConnected) {
                state.boxes.delete(box);
                continue;
            }
            renderBox(state, box);
        }
    }

    // endregion

    // region Placement

    /** Matches the box's colours to the site's theme: light, dim or lights out. */
    function theme() {
        const rgb = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255]).map(Number);
        if (rgb[0] + rgb[1] + rgb[2] < 30) return 'xpt-theme-dark';
        if (rgb[0] < 60 && rgb[2] > rgb[0]) return 'xpt-theme-dim';
        return 'xpt-theme-light';
    }

    function decorate() {
        if (!XPT.on('inlineReplies')) return;

        for (const article of document.querySelectorAll('article[data-testid="tweet"]:not([data-xpt-replies])')) {
            const id = postIdOf(article);
            if (!id) continue;
            // The post a conversation page is about shows its replies already.
            if (id === pagePostId()) {
                article.dataset.xptReplies = 'focal';
                continue;
            }
            article.dataset.xptReplies = 'pending';

            XPT.getPost(id).then(({ post }) => {
                if (!post || !post.replyCount) {
                    article.dataset.xptReplies = 'none';
                    return;
                }
                article.dataset.xptReplies = 'done';
                const state = conversation(post);
                state.post = { ...state.post, ...post };

                const sibling = article.nextElementSibling;
                const box = sibling?.classList.contains('xpt-replies') && sibling.dataset.for === id ? sibling : buildBox(state);
                box.classList.remove('xpt-theme-dark', 'xpt-theme-dim', 'xpt-theme-light');
                box.classList.add(theme());
                if (!box.isConnected) article.after(box);
                state.boxes.add(box);
                box.xpt.rendered = -1;
                renderBox(state, box);
            });
        }
    }

    XPT.scanners.push(decorate);

    // endregion
})();
