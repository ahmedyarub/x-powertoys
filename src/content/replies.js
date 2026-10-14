/*
 * Inline replies: a post's replies open right below it in the timeline, without leaving the page
 * or opening a dialog. The first page loads on Show replies; Load more and Expand all page on,
 * Expand all up to the configured number of replies. What was loaded stays when the post scrolls
 * away and is shown again when it comes back.
 */
(function () {
    'use strict';

    const XPT = globalThis.XPT;
    const { postIdOf, pagePostId, svgIcon } = XPT.ui;

    const ICONS = {
        reply: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h2v2l2.5-2H20V6H4z',
        repost: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
        like: 'M12 21s-7-4.35-9.5-8.5C.9 9.6 2.6 5.5 6.5 5.5c2 0 3.5 1.2 5.5 3.3 2-2.1 3.5-3.3 5.5-3.3 3.9 0 5.6 4.1 4 7-2.5 4.15-9.5 8.5-9.5 8.5zm0-2.4c2.2-1.5 6.2-4.5 7.8-7.2 1-1.8.1-4.4-2.3-4.4-1.3 0-2.4.9-4.5 3.1L12 11.1l-1-1.1C8.9 7.8 7.8 6.9 6.5 6.9c-2.4 0-3.3 2.6-2.3 4.4 1.6 2.7 5.6 5.7 7.8 7.3z',
    };

    const IMAGE_HOST = /^https:\/\/pbs\.twimg\.com\//;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /** What is known of each post's replies, by post id. */
    const conversations = new Map();

    function conversation(post) {
        let state = conversations.get(post.id);
        if (!state) {
            state = {
                post,
                threads: new Map(),
                seen: new Set(),
                next: [],
                loaded: 0,
                started: false,
                open: false,
                busy: false,
                error: null,
                limitReached: false,
                boxes: new Set(),
            };
            conversations.set(post.id, state);
        }
        return state;
    }

    // region Loading

    function addPosts(state, thread, posts) {
        let added = 0;
        for (const post of posts) {
            if (state.seen.has(post.id)) continue;
            state.seen.add(post.id);
            thread.posts.push(post);
            added++;
        }
        state.loaded += added;
        return added;
    }

    /** Folds one answer into what is shown. The number of new replies. */
    function merge(state, answer, usedCursor) {
        let added = 0;
        for (const incoming of answer.threads) {
            let thread = state.threads.get(incoming.id);
            if (!thread) {
                thread = { id: incoming.id, posts: [], cursor: null };
                state.threads.set(incoming.id, thread);
            }
            added += addPosts(state, thread, incoming.posts);
            thread.cursor = incoming.cursor;
        }
        for (const addition of answer.additions) {
            const thread = state.threads.get(addition.id);
            if (!thread) continue;
            added += addPosts(state, thread, addition.posts);
            thread.cursor = addition.cursor;
        }

        const usedPage = state.next.find((page) => page.cursor === usedCursor);
        state.next = state.next.filter((page) => page !== usedPage);
        if (usedPage && !answer.threads.length && !answer.additions.length) {
            // X keeps handing out a cursor of the same kind after the last page; an empty page ends it.
            state.next = state.next.filter((page) => page.type !== usedPage.type);
            return added;
        }
        for (const page of answer.next) {
            if (!state.next.some((known) => known.cursor === page.cursor)) state.next.push(page);
        }
        return added;
    }

    async function request(state, cursor) {
        const { conversation: answer, error } = await XPT.getConversation(state.post.id, cursor);
        if (error) throw new Error(error);
        return merge(state, answer, cursor);
    }

    function hasMore(state) {
        return state.next.length > 0 || [...state.threads.values()].some((thread) => thread.cursor);
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

    function showReplies(state) {
        state.open = !state.open;
        if (state.open && !state.started) {
            state.started = true;
            run(state, () => request(state, null));
        } else {
            update(state);
        }
    }

    function loadMore(state) {
        const page = state.next[0];
        if (page) run(state, () => request(state, page.cursor));
    }

    function loadThread(state, thread) {
        const cursor = thread.cursor;
        if (!cursor) return;
        run(state, async () => {
            thread.cursor = null;
            try {
                await request(state, cursor);
            } catch (error) {
                thread.cursor = cursor;
                throw error;
            }
        });
    }

    /**
     * Loads replies until the limit: the threads' own Show more first, then further pages, with
     * a pause between requests so X does not start refusing them.
     */
    function expandAll(state) {
        const limit = Number(XPT.opt('inlineReplies', 'maxReplies')) || 100;
        run(state, async () => {
            let idle = 0;
            while (state.loaded < limit && idle < 3) {
                const thread = [...state.threads.values()].find((candidate) => candidate.cursor);
                const page = state.next[0];
                if (!thread && !page) break;

                let added;
                if (thread) {
                    const cursor = thread.cursor;
                    thread.cursor = null;
                    added = await request(state, cursor);
                } else {
                    added = await request(state, page.cursor);
                }
                idle = added ? 0 : idle + 1;
                update(state);
                await sleep(400);
            }
            state.limitReached = state.loaded >= limit && hasMore(state);
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

    function buildBox(state) {
        const box = element('div', 'xpt-replies');
        box.dataset.for = state.post.id;

        // The cell opens the post on a press; presses in here are the box's own.
        for (const type of ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            box.addEventListener(type, (event) => event.stopPropagation());
        }

        const bar = element('div', 'xpt-replies-bar');
        const toggle = element('button', 'xpt-replies-button');
        toggle.type = 'button';
        toggle.addEventListener('click', () => showReplies(state));
        const more = element('button', 'xpt-replies-button', 'Load more');
        more.type = 'button';
        more.addEventListener('click', () => loadMore(state));
        const all = element('button', 'xpt-replies-button', 'Expand all');
        all.type = 'button';
        all.addEventListener('click', () => expandAll(state));
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

        toggle.textContent = state.open ? 'Hide replies' : `Show replies${total ? ` (${count(total)})` : ''}`;
        const canLoad = state.open && state.started && !state.busy && hasMore(state);
        more.hidden = !canLoad || !state.next.length;
        all.hidden = !canLoad || state.limitReached;
        toggle.disabled = false;

        if (state.busy) status.textContent = 'Loading…';
        else if (state.error) status.textContent = state.error;
        else if (state.open && state.started) {
            status.textContent = `${state.loaded} ${state.loaded === 1 ? 'reply' : 'replies'}` +
                (state.limitReached ? ' · Expand all limit reached' : !hasMore(state) ? ' · all loaded' : '');
        } else status.textContent = '';
        status.classList.toggle('xpt-error', Boolean(state.error));

        list.hidden = !state.open;
        if (!state.open || box.xpt.rendered === state.loaded + (hasMore(state) ? 0.5 : 0)) return;
        box.xpt.rendered = state.loaded + (hasMore(state) ? 0.5 : 0);

        list.replaceChildren();
        for (const thread of state.threads.values()) {
            if (!thread.posts.length && !thread.cursor) continue;
            const group = element('div', 'xpt-thread');
            for (const post of thread.posts) group.append(replyNode(post));
            if (thread.cursor) {
                const button = element('button', 'xpt-replies-button xpt-thread-more', 'Show more replies');
                button.type = 'button';
                button.addEventListener('click', () => loadThread(state, thread));
                group.append(button);
            }
            list.append(group);
        }
        if (state.started && !state.loaded && !state.busy && !state.error) {
            list.append(element('div', 'xpt-muted xpt-replies-empty', 'No replies to show.'));
        }
    }

    function update(state) {
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
