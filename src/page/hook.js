/*
 * Runs in the page itself, before x.com's own scripts, so it can stand between the site and the
 * network: requests and responses go through XPT_REWRITE, the boot state through
 * patchInitialState, posts through Undo Posts, and copied links through the link patches.
 *
 * The settings come from the content script: the last known copy is read from localStorage at
 * once, since the boot state is read before any message could arrive, and updates come by message.
 */
(function () {
    'use strict';

    const catalogue = window.XPT_CATALOGUE;
    const R = window.XPT_REWRITE;
    delete window.XPT_CATALOGUE;
    delete window.XPT_REWRITE;
    if (!catalogue || !R) return;

    const { on, opt } = catalogue;
    const SETTINGS_KEY = 'xpt:settings';

    let settings = catalogue.merge(readStoredSettings());

    function readStoredSettings() {
        try {
            return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        } catch {
            return null;
        }
    }

    // region Post store

    /** Posts seen in responses, by id: the summary the UI asks for and the raw object. */
    const posts = new Map();
    const links = new Map();
    const POST_LIMIT = 4000;
    const LINK_LIMIT = 20000;

    const store = {
        add(post) {
            if (posts.has(post.rest_id)) posts.delete(post.rest_id);
            posts.set(post.rest_id, post);
            if (posts.size > POST_LIMIT) posts.delete(posts.keys().next().value);
        },
        link(short, expanded) {
            links.set(short, expanded);
            if (links.size > LINK_LIMIT) links.delete(links.keys().next().value);
        },
    };

    function screenNameOf(id) {
        const post = posts.get(id);
        return post ? R.summarize(post).screenName : null;
    }

    // endregion

    // region Follow state

    /** Follow states the server confirmed this visit, by user id; newer than any post's copy. */
    const confirmedFollows = new Map();

    function viewerId() {
        const match = document.cookie.match(/(?:^|;\s*)twid=([^;]+)/);
        const value = match ? decodeURIComponent(match[1]) : '';
        return (value.match(/u=(\d+)/) || [])[1] || null;
    }

    /** 'following', 'requested' or 'none'. */
    function followState(author) {
        if (confirmedFollows.has(author.id)) return confirmedFollows.get(author.id);
        if (author.following) return 'following';
        if (author.followRequestSent) return 'requested';
        return 'none';
    }

    const FRIENDSHIP = /\/1\.1\/friendships\/(create|destroy|cancel)\.json$/;

    /**
     * Records the outcome of a follow, unfollow or request cancel once the server has answered,
     * and tells the UI. Nothing is reported for a request that failed.
     */
    function watchFriendship(method, url, body, status, responseText) {
        const action = method === 'POST' && (new URL(url, location.href).pathname.match(FRIENDSHIP) || [])[1];
        if (!action || status !== 200) return;

        let user = null;
        try {
            user = JSON.parse(responseText);
        } catch {
            // Fall back to the id the request named.
        }
        const userId = user?.id_str || (typeof body === 'string' ? new URLSearchParams(body).get('user_id') : null);
        if (!userId) return;

        const state = action === 'create' ? (user?.protected === true ? 'requested' : 'following') : 'none';
        confirmedFollows.set(userId, state);
        window.postMessage('xpt:' + JSON.stringify({ to: 'ui', type: 'follow', userId, state }), location.origin);
    }

    // endregion

    // region Messages

    window.addEventListener('message', (event) => {
        if (event.source !== window || typeof event.data !== 'string' || !event.data.startsWith('xpt:')) return;

        let message;
        try {
            message = JSON.parse(event.data.slice(4));
        } catch {
            return;
        }

        if (message.to !== 'page') return;
        if (message.type === 'settings') {
            settings = catalogue.merge(message.settings);
        } else if (message.type === 'getPost') {
            const post = posts.get(String(message.id));
            reply(message, post ? { post: describe(post), raw: message.raw ? post : undefined } : { post: null });
        } else if (message.type === 'getConversation') {
            loadConversation(String(message.id), message.cursor ? String(message.cursor) : null)
                .then((conversation) => reply(message, { conversation }))
                .catch((error) => reply(message, { error: error?.message || String(error) }));
        }
    });

    /** A post's summary with what only the page knows: the follow state and if it is your own. */
    function describe(post) {
        const summary = R.summarize(post);
        summary.followState = followState(summary.author);
        summary.isViewer = summary.author.id !== '' && summary.author.id === viewerId();
        return summary;
    }

    function reply(message, payload) {
        window.postMessage('xpt:' + JSON.stringify({ to: 'ui', type: 'reply', requestId: message.requestId, ...payload }), location.origin);
    }

    // endregion

    // region Conversations

    /**
     * How the site asks for a conversation, taken from its own TweetDetail requests: the query
     * id, features, field toggles and variables. Until it has made one, they come from its script.
     */
    let detailRequest = null;
    /** The headers the site sends its API: its bearer token and client details. */
    const apiHeaders = {};
    const KEPT_HEADERS = ['authorization', 'x-twitter-auth-type', 'x-twitter-active-user', 'x-twitter-client-language'];

    function rememberDetailRequest(url) {
        const u = new URL(url, location.href);
        const queryId = u.pathname.split('/').slice(-2)[0];
        let variables = {};
        try {
            variables = JSON.parse(u.searchParams.get('variables') || '{}');
        } catch {
            // Keep the defaults below.
        }
        detailRequest = {
            queryId,
            features: u.searchParams.get('features') || '{}',
            fieldToggles: u.searchParams.get('fieldToggles') || '{}',
            variables,
        };
    }

    async function detailRequestFromScript() {
        const source = [...document.scripts].map((script) => script.src).find((src) => /\/client-web\/main\.[\w.]+\.js$/.test(src));
        if (!source) throw new Error('Open any post once, then try again');

        const script = await (await nativeFetch.call(window, source)).text();
        const at = script.indexOf('operationName:"TweetDetail"');
        const queryId = script.slice(Math.max(0, at - 80), at).match(/queryId:"([^"]+)"/)?.[1];
        if (at < 0 || !queryId) throw new Error('Open any post once, then try again');

        const block = script.slice(at, at + 4000);
        const list = (name) => ((block.match(new RegExp(`${name}:\\[([^\\]]*)\\]`)) || [])[1] || '')
            .split(',').map((item) => item.replace(/"/g, '').trim()).filter(Boolean);
        const config = initialState?.featureSwitch?.user?.config || initialState?.featureSwitch?.defaultConfig || {};
        const features = Object.fromEntries(list('featureSwitches').map((key) => [key, config[key]?.value === true]));
        const fieldToggles = Object.fromEntries(list('fieldToggles').map((key) => [key, false]));

        if (!apiHeaders.authorization) {
            const bearer = script.match(/"(AAAAAAAAAAAAAAAAAAAAA[^"]+)"/)?.[1];
            if (bearer) apiHeaders.authorization = `Bearer ${bearer}`;
        }
        return { queryId, features: JSON.stringify(features), fieldToggles: JSON.stringify(fieldToggles), variables: {} };
    }

    /** One page of a post's replies, through the same rewriting as the site's own requests. */
    async function loadConversation(id, cursor) {
        const request = detailRequest || await detailRequestFromScript();
        const variables = {
            with_rux_injections: false,
            rankingMode: 'Relevance',
            includePromotedContent: true,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true,
            ...request.variables,
            focalTweetId: id,
            referrer: 'tweet',
        };
        delete variables.controller_data;
        if (cursor) variables.cursor = cursor;
        else delete variables.cursor;

        const url = `https://${location.host}/i/api/graphql/${request.queryId}/TweetDetail?` + new URLSearchParams({
            variables: JSON.stringify(variables),
            features: request.features,
            fieldToggles: request.fieldToggles,
        });

        const text = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.withCredentials = true;
            for (const [name, value] of Object.entries(apiHeaders)) xhr.setRequestHeader(name, value);
            const csrf = (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1];
            if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
            xhr.onload = () => {
                if (xhr.status === 200) resolve(xhr.responseText);
                else if (xhr.status === 429) reject(new Error('X is limiting requests; try again in a few minutes'));
                else reject(new Error(`X answered ${xhr.status}`));
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send();
        });

        const parsed = R.parseConversation(JSON.parse(text), id);
        return {
            threads: parsed.threads.map((thread) => ({ id: thread.id, cursor: thread.cursor, posts: thread.posts.map(describe) })),
            additions: parsed.additions.map((thread) => ({ id: thread.id, cursor: thread.cursor, posts: thread.posts.map(describe) })),
            next: parsed.next,
        };
    }

    // endregion

    // region Boot state

    let initialState;
    try {
        Object.defineProperty(window, '__INITIAL_STATE__', {
            configurable: true,
            enumerable: true,
            get: () => initialState,
            set(value) {
                try {
                    R.patchInitialState(value, settings);
                } catch (error) {
                    console.warn('[X Power Toys] Could not patch the boot state', error);
                }
                initialState = value;
            },
        });
    } catch (error) {
        console.warn('[X Power Toys] Could not hook the boot state', error);
    }

    // endregion

    // region Requests

    /** Conversations already opened with the chosen reply sort, pruned as the page moves on. */
    const sorted = new Set();

    function requestContext() {
        for (const id of sorted) {
            if (!location.pathname.includes(id)) sorted.delete(id);
        }
        return { sorted };
    }

    function rewriteUrl(url) {
        try {
            return R.classify(url) === 'api' ? R.rewriteRequestUrl(url, settings, requestContext()) : url;
        } catch (error) {
            console.warn('[X Power Toys] Request rewrite failed', error);
            return url;
        }
    }

    function rewriteBody(url, body) {
        try {
            return R.classify(url) === 'api' ? R.rewriteRequestBody(url, body, settings, requestContext()) : body;
        } catch (error) {
            console.warn('[X Power Toys] Request body rewrite failed', error);
            return body;
        }
    }

    function transform(url, text) {
        try {
            return R.transformResponse(url, text, settings, store);
        } catch (error) {
            console.warn('[X Power Toys] Response rewrite failed', url, error);
            return text;
        }
    }

    function isPostCreation(method, url) {
        return method === 'POST' && R.classify(url) === 'api' && /\/(?:CreateTweet|CreateNoteTweet)$/.test(new URL(url, location.href).pathname);
    }

    // endregion

    // region XMLHttpRequest

    const xhrProto = XMLHttpRequest.prototype;
    const nativeOpen = xhrProto.open;
    const nativeSend = xhrProto.send;
    const textDescriptor = Object.getOwnPropertyDescriptor(xhrProto, 'responseText');
    const responseDescriptor = Object.getOwnPropertyDescriptor(xhrProto, 'response');
    const requests = new WeakMap();

    xhrProto.open = function (method, url, ...rest) {
        const info = { method: String(method).toUpperCase(), url: String(url) };
        info.kind = R.classify(info.url);
        if (info.kind === 'api') {
            if (R.operation(info.url) === 'TweetDetail') {
                try {
                    rememberDetailRequest(info.url);
                } catch {
                    // An odd URL; the script is read instead when replies are wanted.
                }
            }
            info.url = rewriteUrl(info.url);
        }
        requests.set(this, info);
        return nativeOpen.call(this, method, info.url, ...rest);
    };

    const nativeSetRequestHeader = xhrProto.setRequestHeader;
    xhrProto.setRequestHeader = function (name, value) {
        const key = String(name).toLowerCase();
        if (requests.get(this)?.kind === 'api' && KEPT_HEADERS.includes(key)) apiHeaders[key] = String(value);
        return nativeSetRequestHeader.call(this, name, value);
    };

    xhrProto.send = function (body) {
        const info = requests.get(this);
        if (!info?.kind) return nativeSend.call(this, body);

        const rewritten = rewriteBody(info.url, body);
        if (FRIENDSHIP.test(new URL(info.url, location.href).pathname)) {
            this.addEventListener('load', () => {
                let text = '';
                try {
                    text = textDescriptor.get.call(this);
                } catch {
                    // A JSON or binary response type; the request body names the user.
                }
                watchFriendship(info.method, info.url, rewritten, this.status, text);
            });
        }
        if (on(settings, 'undoPosts') && isPostCreation(info.method, info.url)) {
            holdPost(rewritten).then((send) => {
                if (send) nativeSend.call(this, rewritten);
                else failRequest(this);
            });
            return undefined;
        }
        return nativeSend.call(this, rewritten);
    };

    /** The response the site reads, rewritten once per request. */
    function rewrittenText(xhr, raw) {
        const info = requests.get(xhr);
        if (!info?.kind || xhr.readyState !== 4 || typeof raw !== 'string') return raw;
        if (info.rawText !== raw) {
            info.rawText = raw;
            info.text = transform(info.url, raw);
        }
        return info.text;
    }

    Object.defineProperty(xhrProto, 'responseText', {
        configurable: true,
        enumerable: textDescriptor.enumerable,
        get() {
            return rewrittenText(this, textDescriptor.get.call(this));
        },
    });

    Object.defineProperty(xhrProto, 'response', {
        configurable: true,
        enumerable: responseDescriptor.enumerable,
        get() {
            const raw = responseDescriptor.get.call(this);
            if (typeof raw === 'string') return rewrittenText(this, raw);

            const info = requests.get(this);
            if (info?.kind === 'api' && this.responseType === 'json' && raw && typeof raw === 'object' && this.readyState === 4) {
                if (info.rawObject !== raw) {
                    info.rawObject = raw;
                    try {
                        R.transformJson(info.url, raw, settings, store);
                    } catch (error) {
                        console.warn('[X Power Toys] Response rewrite failed', info.url, error);
                    }
                }
            }
            return raw;
        },
    });

    /** Ends a held request as a network failure, without it ever being sent. */
    function failRequest(xhr) {
        Object.defineProperty(xhr, 'readyState', { configurable: true, value: 4 });
        Object.defineProperty(xhr, 'status', { configurable: true, value: 0 });
        for (const type of ['readystatechange', 'error', 'loadend']) {
            xhr.dispatchEvent(type === 'readystatechange' ? new Event(type) : new ProgressEvent(type));
        }
    }

    // endregion

    // region fetch

    const nativeFetch = window.fetch;

    window.fetch = async function (input, init) {
        const request = input instanceof Request ? input : null;
        const url = String(request ? request.url : input);
        const kind = R.classify(url);
        if (!kind) return nativeFetch.call(this, input, init);

        const method = String(init?.method || request?.method || 'GET').toUpperCase();
        let target = input;
        let options = init;

        if (kind === 'api') {
            const rewrittenUrl = rewriteUrl(url);
            if (rewrittenUrl !== url) target = request ? new Request(rewrittenUrl, request) : rewrittenUrl;
            if (typeof init?.body === 'string') options = { ...init, body: rewriteBody(url, init.body) };

            if (on(settings, 'undoPosts') && isPostCreation(method, url)) {
                const body = typeof options?.body === 'string' ? options.body : '';
                if (!(await holdPost(body))) throw new TypeError('NetworkError when attempting to fetch resource.');
            }
        }

        const response = await nativeFetch.call(this, target, options);
        if (kind === 'api' && FRIENDSHIP.test(new URL(url, location.href).pathname)) {
            response.clone().text().then((text) => watchFriendship(method, url, options?.body, response.status, text)).catch(() => {});
        }
        const type = response.headers.get('content-type') || '';
        if (kind === 'api' && !type.includes('json')) return response;

        const text = await response.clone().text();
        const out = transform(url, text);
        if (out === text) return response;

        // The body is already decoded and its length changed.
        const headers = new Headers(response.headers);
        headers.delete('content-encoding');
        headers.delete('content-length');
        return new Response(out, { status: response.status, statusText: response.statusText, headers });
    };

    // endregion

    // region Undo Posts

    /** Shows the countdown for a post. Resolves true to send it, false when it was undone. */
    function holdPost(body) {
        const seconds = Number(opt(settings, 'undoPosts', 'seconds')) || 10;
        const postText = (() => {
            try {
                return JSON.parse(body).variables?.tweet_text || '';
            } catch {
                return '';
            }
        })();

        return new Promise((resolve) => {
            const host = document.createElement('div');
            const shadow = host.attachShadow({ mode: 'closed' });
            shadow.innerHTML = `
                <style>
                    .toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 2147483647;
                        display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-radius: 8px;
                        background: #1d9bf0; color: #fff; font: 15px/20px -apple-system, "Segoe UI", Roboto, sans-serif;
                        box-shadow: 0 4px 16px rgba(0,0,0,.3); max-width: calc(100vw - 32px); }
                    button { border: 0; border-radius: 999px; padding: 6px 14px; font: inherit; font-weight: 700; cursor: pointer; }
                    .undo { background: #fff; color: #0f1419; }
                    .now { background: transparent; color: #fff; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6); }
                </style>
                <div class="toast" role="status">
                    <span class="label"></span>
                    <button class="undo" type="button">Undo</button>
                    <button class="now" type="button">Send now</button>
                </div>`;
            const label = shadow.querySelector('.label');
            let left = seconds;
            const render = () => { label.textContent = `Sending your post in ${left}s`; };
            render();
            (document.body || document.documentElement).appendChild(host);

            let done = false;
            const finish = (send) => {
                if (done) return;
                done = true;
                clearInterval(timer);
                host.remove();
                resolve(send);
            };
            const timer = setInterval(() => {
                left -= 1;
                if (left <= 0) finish(true);
                else render();
            }, 1000);

            shadow.querySelector('.now').addEventListener('click', () => finish(true));
            shadow.querySelector('.undo').addEventListener('click', () => {
                finish(false);
                if (postText) navigator.clipboard?.writeText(postText).catch(() => {});
                notify(postText ? 'Post undone. Its text was copied to the clipboard.' : 'Post undone.');
            });
        });
    }

    function notify(text) {
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `<style>div { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 2147483647;
            padding: 12px 16px; border-radius: 8px; background: #1d9bf0; color: #fff;
            font: 15px/20px -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.3); }</style>
            <div role="status"></div>`;
        shadow.querySelector('div').textContent = text;
        (document.body || document.documentElement).appendChild(host);
        setTimeout(() => host.remove(), 4000);
    }

    // endregion

    // region Shared and copied links

    const shareText = (text) => {
        try {
            return R.transformShareText(text, settings, screenNameOf);
        } catch {
            return text;
        }
    };

    if (window.Clipboard?.prototype?.writeText) {
        const nativeWriteText = Clipboard.prototype.writeText;
        Clipboard.prototype.writeText = function (text) {
            return nativeWriteText.call(this, shareText(String(text)));
        };
    }

    // The site copies through a selected element and execCommand('copy'); the copy event it
    // raises gets the rewritten text instead, before any listener of the site's sees it.
    const nativeExecCommand = Document.prototype.execCommand;
    Document.prototype.execCommand = function (command, ...rest) {
        if (String(command).toLowerCase() !== 'copy') return nativeExecCommand.call(this, command, ...rest);

        const selected = String(window.getSelection?.() || '');
        const rewritten = shareText(selected);
        if (!selected || rewritten === selected) return nativeExecCommand.call(this, command, ...rest);

        const onCopy = (event) => {
            event.clipboardData.setData('text/plain', rewritten);
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        window.addEventListener('copy', onCopy, true);
        try {
            return nativeExecCommand.call(this, command, ...rest);
        } finally {
            window.removeEventListener('copy', onCopy, true);
        }
    };

    if (navigator.share) {
        const nativeShare = navigator.share.bind(navigator);
        navigator.share = (data) => {
            if (!data || typeof data !== 'object') return nativeShare(data);
            const shared = { ...data };
            if (typeof shared.url === 'string') shared.url = shareText(shared.url);
            if (typeof shared.text === 'string') shared.text = shareText(shared.text);
            return nativeShare(shared);
        };
    }

    // Links the responses did not resolve still point at t.co; follow the expanded address.
    for (const type of ['click', 'auxclick']) {
        document.addEventListener(type, (event) => {
            if (!on(settings, 'noShortenedUrl')) return;
            const anchor = event.target?.closest?.('a[href^="https://t.co/"]');
            const expanded = anchor && links.get(anchor.href);
            if (expanded) anchor.href = expanded;
        }, true);
    }

    // endregion
})();
