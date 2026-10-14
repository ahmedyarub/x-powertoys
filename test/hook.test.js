'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

/** The page hook in a minimal page: a fake XMLHttpRequest, window messages and cookies. */
function page() {
    const messages = [];
    const listeners = {};

    class FakeXHR {
        constructor() {
            this.listeners = {};
            this.readyState = 0;
            this.status = 0;
            this.body = '';
            this.responseType = '';
        }
        open(method, url) {
            this.method = method;
            this.url = url;
            this.readyState = 1;
        }
        send(body) {
            this.sent = body;
        }
        addEventListener(type, listener) {
            (this.listeners[type] ||= []).push(listener);
        }
        dispatchEvent(event) {
            for (const listener of this.listeners[event.type] || []) listener(event);
        }
        /** The server answers. */
        respond(status, text) {
            this.readyState = 4;
            this.status = status;
            this.body = text;
            this.dispatchEvent({ type: 'load' });
        }
    }
    Object.defineProperty(FakeXHR.prototype, 'responseText', { configurable: true, get() { return this.body; } });
    Object.defineProperty(FakeXHR.prototype, 'response', { configurable: true, get() { return this.body; } });

    // The context's global object is the page's window, as it is in a browser.
    const context = vm.createContext({
        XMLHttpRequest: FakeXHR,
        location: { href: 'https://x.com/home', origin: 'https://x.com', pathname: '/home' },
        localStorage: { getItem: () => null },
        fetch: async () => { throw new Error('not used'); },
        addEventListener: (type, listener) => (listeners[type] ||= []).push(listener),
        postMessage: (data) => messages.push(JSON.parse(data.slice(4))),
        console: { warn() {} },
        document: { cookie: 'ct0=abc; twid=u%3D77', addEventListener() {}, createElement() { return {}; } },
        navigator: {},
        Document: function Document() {},
        URL,
        URLSearchParams,
    });
    context.window = context;
    context.Document.prototype.execCommand = () => true;
    // Inside the context its global is a proxy of the sandbox; messages come from that.
    const window = vm.runInContext('window', context);

    vm.runInContext(source('shared/catalogue.js'), context);
    vm.runInContext(source('page/rewrite.js'), context);
    vm.runInContext(source('page/hook.js'), context);

    const post = (id, state) => ({
        __typename: 'Tweet',
        rest_id: id,
        core: { user_results: { result: { rest_id: '5', core: { screen_name: 'someone' }, relationship_perspectives: { following: state } } } },
        legacy: { full_text: 'hi', entities: {} },
    });
    const deliver = (data) => {
        for (const listener of listeners.message || []) listener({ source: window, data: 'xpt:' + JSON.stringify(data) });
    };
    return { context, messages, post, deliver, FakeXHR };
}

function friendship(env, action, status, response) {
    const xhr = new env.context.XMLHttpRequest();
    xhr.open('POST', `https://x.com/i/api/1.1/friendships/${action}.json`);
    xhr.send('include_profile_interstitial_type=1&user_id=5');
    xhr.respond(status, response);
    return xhr;
}

function followMessages(env) {
    return env.messages.filter((message) => message.type === 'follow');
}

test('a follow is reported once the server confirms it, not when it is sent', () => {
    const env = page();
    const xhr = new env.context.XMLHttpRequest();
    xhr.open('POST', 'https://x.com/i/api/1.1/friendships/create.json');
    xhr.send('user_id=5');
    assert.deepEqual(followMessages(env), [], 'nothing before the answer');

    xhr.respond(200, JSON.stringify({ id_str: '5', protected: false }));
    assert.deepEqual(followMessages(env), [{ to: 'ui', type: 'follow', userId: '5', state: 'following' }]);
});

test('a failed follow is not reported', () => {
    const env = page();
    friendship(env, 'create', 403, '{"errors":[{"code":161}]}');
    assert.deepEqual(followMessages(env), []);
});

test('protected accounts are requested; unfollow and cancel are reported as none', () => {
    const env = page();
    friendship(env, 'create', 200, JSON.stringify({ id_str: '5', protected: true }));
    friendship(env, 'destroy', 200, JSON.stringify({ id_str: '5' }));
    friendship(env, 'cancel', 200, '');
    assert.deepEqual(followMessages(env).map((message) => message.state), ['requested', 'none', 'none']);
});

test('posts report the confirmed follow state and whether they are your own', () => {
    const env = page();

    // A timeline response puts the post in the store.
    const timeline = new env.context.XMLHttpRequest();
    timeline.open('GET', 'https://x.com/i/api/graphql/q/HomeTimeline');
    timeline.send();
    timeline.readyState = 4;
    timeline.body = JSON.stringify({ data: { post: env.post('9', false) } });
    void timeline.responseText;

    env.deliver({ to: 'page', type: 'getPost', id: '9', requestId: 'a' });
    let reply = env.messages.find((message) => message.requestId === 'a');
    assert.equal(reply.post.followState, 'none');
    assert.equal(reply.post.isViewer, false);

    friendship(env, 'create', 200, JSON.stringify({ id_str: '5', protected: false }));
    env.deliver({ to: 'page', type: 'getPost', id: '9', requestId: 'b' });
    reply = env.messages.find((message) => message.requestId === 'b');
    assert.equal(reply.post.followState, 'following');
});

function post(env, url, body, status, response) {
    const xhr = new env.context.XMLHttpRequest();
    xhr.open('POST', url);
    xhr.send(body);
    xhr.respond(status, response);
}

test('a block is reported once the server confirms it, and shows on the author of posts', () => {
    const env = page();
    const timeline = new env.context.XMLHttpRequest();
    timeline.open('GET', 'https://x.com/i/api/graphql/q/HomeTimeline');
    timeline.send();
    timeline.readyState = 4;
    timeline.body = JSON.stringify({ data: { post: env.post('9', true) } });
    void timeline.responseText;

    post(env, 'https://x.com/i/api/1.1/blocks/create.json', 'user_id=5', 403, '{"errors":[]}');
    assert.deepEqual(env.messages.filter((m) => m.type === 'block'), [], 'a failed block is not reported');

    post(env, 'https://x.com/i/api/1.1/blocks/create.json', 'user_id=5', 200, JSON.stringify({ id_str: '5' }));
    assert.deepEqual(env.messages.filter((m) => m.type === 'block'), [{ to: 'ui', type: 'block', userId: '5', state: 'blocked' }]);

    env.deliver({ to: 'page', type: 'getPost', id: '9', requestId: 'c' });
    const reply = env.messages.find((message) => message.requestId === 'c');
    assert.equal(reply.post.author.blocking, true);
    assert.equal(reply.post.followState, 'none', 'a block ends the follow');

    post(env, 'https://x.com/i/api/1.1/blocks/destroy.json', 'user_id=5', 200, JSON.stringify({ id_str: '5' }));
    assert.equal(env.messages.filter((m) => m.type === 'block').pop().state, 'none');
});

test('Not interested feedback is reported once the server confirms it, an Undo as such', () => {
    const env = page();
    const url = 'https://x.com/i/api/graphql/q/timelinesFeedback';
    const body = (undo) => JSON.stringify({ variables: { encoded_feedback_request: 'opaque', undo }, queryId: 'q' });

    post(env, url, body(false), 500, '{}');
    post(env, url, body(false), 200, '{"data":{}}');
    post(env, url, body(true), 200, '{"data":{}}');
    assert.deepEqual(env.messages.filter((m) => m.type === 'feedback').map((m) => m.undo), [false, true]);
});
