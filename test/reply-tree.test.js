'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { XPT_REPLY_TREE: T } = require('../src/content/reply-tree.js');

const post = (id, inReplyToId, replyCount = 0) => ({ id, inReplyToId, replyCount });
const thread = (id, posts, cursor = null) => ({ id, posts, cursor });

/** The tree as indented ids, for comparing. */
function outline(conversation) {
    const tree = T.children(conversation);
    const lines = [];
    const walk = (id, depth) => {
        for (const child of tree.get(id) || []) {
            lines.push(`${'  '.repeat(depth)}${child}`);
            walk(child, depth + 1);
        }
    };
    walk(conversation.root.id, 0);
    return lines;
}

test('replies hang under the post they answer, at any depth', () => {
    const conversation = T.createConversation(post('root', null, 3));
    T.merge(conversation, 'root', {
        threads: [
            thread('t1', [post('a', 'root', 1), post('a1', 'a', 1), post('a2', 'a1')]),
            thread('t2', [post('b', 'root')]),
        ],
        next: [],
    });
    assert.deepEqual(outline(conversation), ['a', '  a1', '    a2', 'b']);
});

test('a reply whose parent is not loaded hangs under the post', () => {
    const conversation = T.createConversation(post('root', null, 2));
    T.merge(conversation, 'root', { threads: [thread('t1', [post('x', 'missing')]), thread('t2', [post('y', 'root')])], next: [] });
    assert.deepEqual(outline(conversation), ['x', 'y']);
});

test('a branch opened later slots under its reply; repeats are not added twice', () => {
    const conversation = T.createConversation(post('root', null, 2));
    T.merge(conversation, 'root', { threads: [thread('t1', [post('a', 'root', 3), post('a1', 'a')]), thread('t2', [post('b', 'root')])], next: [] });
    const added = T.merge(conversation, 'a', { threads: [thread('u1', [post('a1', 'a')]), thread('u2', [post('a2', 'a')]), thread('u3', [post('a3', 'a')])], next: [] });
    assert.equal(added, 2);
    assert.equal(conversation.loaded, 5);
    assert.deepEqual(outline(conversation), ['a', '  a1', '  a2', '  a3', 'b']);
});

test('a thread X cut short continues from its last post', () => {
    const conversation = T.createConversation(post('root', null, 1));
    T.merge(conversation, 'root', { threads: [thread('t1', [post('a', 'root'), post('a1', 'a')], 'more-t1')], next: [] });
    assert.deepEqual(T.moreAt(conversation, 'a1').map((m) => m.kind + ':' + m.cursor), ['thread:more-t1']);

    T.merge(conversation, 'root', { threads: [], additions: [thread('t1', [post('a2', 'a1')], null)], next: [] });
    assert.deepEqual(T.moreAt(conversation, 'a1'), []);
    assert.deepEqual(T.moreAt(conversation, 'a2'), []);
    assert.deepEqual(outline(conversation), ['a', '  a1', '    a2']);
});

test('Expand all opens the replies shown, all the way down in reading order, before the next page', () => {
    const conversation = T.createConversation(post('root', null, 5));
    assert.deepEqual(T.nextWork(conversation), { kind: 'page', id: 'root', source: 'root', cursor: null, first: true });

    T.merge(conversation, 'root', {
        threads: [thread('t1', [post('a', 'root', 2)], 'more-a'), thread('t2', [post('b', 'root', 1)])],
        next: [{ cursor: 'page-2', type: 'Bottom' }],
    });
    // a first: the rest of its thread, then its own replies.
    assert.deepEqual(T.nextWork(conversation), { kind: 'thread', id: 'a', source: 'root', cursor: 'more-a' });
    conversation.threadCursors.delete('a');
    assert.deepEqual(T.nextWork(conversation), { kind: 'page', id: 'a', source: 'a', cursor: null, first: true, remaining: 2 });

    T.merge(conversation, 'a', { threads: [thread('u1', [post('a1', 'a', 1)]), thread('u2', [post('a2', 'a')])], next: [] });
    // Down a's branch before b: a1's replies.
    assert.equal(T.nextWork(conversation).id, 'a1');
    T.merge(conversation, 'a1', { threads: [thread('w1', [post('a1x', 'a1')])], next: [] });
    assert.equal(T.nextWork(conversation).id, 'b');
    T.merge(conversation, 'b', { threads: [thread('v1', [post('b1', 'b')])], next: [] });

    // Only now the post's next page.
    assert.deepEqual(T.nextWork(conversation), { kind: 'page', id: 'root', source: 'root', cursor: 'page-2' });
    T.merge(conversation, 'root', { threads: [], next: [] }, 'page-2');
    assert.equal(T.nextWork(conversation), null);
    assert.deepEqual(outline(conversation), ['a', '  a1', '    a1x', '  a2', 'b', '  b1']);
});

test('a branch that answers with nothing is done', () => {
    const conversation = T.createConversation(post('root', null, 1));
    T.merge(conversation, 'root', { threads: [thread('t1', [post('a', 'root', 4)])], next: [] });
    T.merge(conversation, 'a', { threads: [], next: [] });
    assert.equal(T.nextWork(conversation), null);
});

test('several branches load at once, each from its own reply; the next page waits for them', () => {
    const conversation = T.createConversation(post('root', null, 3));
    T.merge(conversation, 'root', {
        threads: [thread('t1', [post('a', 'root', 2)], 'more-a'), thread('t2', [post('b', 'root', 1)]), thread('t3', [post('c', 'root', 1)])],
        next: [{ cursor: 'page-2', type: 'Bottom' }],
    });
    assert.deepEqual(T.nextWorks(conversation, 3).map((w) => `${w.kind}:${w.id}`), ['thread:a', 'page:b', 'page:c']);

    conversation.threadCursors.delete('a');
    for (const id of ['a', 'b', 'c']) T.merge(conversation, id, { threads: [], next: [] });
    assert.deepEqual(T.nextWorks(conversation, 3).map((w) => `${w.kind}:${w.id}:${w.cursor}`), ['page:root:page-2']);
});
