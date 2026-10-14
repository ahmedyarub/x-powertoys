/*
 * The replies of one post as a tree, for Inline replies.
 *
 * Replies are loaded from several conversations: the post's own, and that of every reply opened
 * under it ("sources"). Each loaded reply hangs under the post it answers; one whose parent is not
 * loaded hangs under the post itself. The tree says what can be loaded next.
 */
(function (root) {
    'use strict';

    function createConversation(post) {
        return {
            root: post,
            posts: new Map(),
            order: [],
            sources: new Map(),
            /** Where a thread X cut short continues: by the id of its last loaded post. */
            threadCursors: new Map(),
            /** The last loaded post of each thread, by source and thread id. */
            threadEnds: new Map(),
            loaded: 0,
        };
    }

    function source(conversation, id) {
        let found = conversation.sources.get(id);
        if (!found) {
            found = { id, started: false, next: [] };
            conversation.sources.set(id, found);
        }
        return found;
    }

    function addPost(conversation, post) {
        if (post.id === conversation.root.id) return false;
        const known = conversation.posts.get(post.id);
        if (known) {
            // A fresher copy, e.g. with its counts updated; its place stays.
            conversation.posts.set(post.id, { ...known, ...post });
            return false;
        }
        conversation.posts.set(post.id, post);
        conversation.order.push(post.id);
        conversation.loaded++;
        return true;
    }

    function addThread(conversation, sourceId, thread) {
        const key = `${sourceId}\n${thread.id}`;
        const previousEnd = conversation.threadEnds.get(key);
        let added = 0;
        let end = previousEnd || null;
        for (const post of thread.posts) {
            if (addPost(conversation, post)) added++;
            end = post.id;
        }
        if (previousEnd) conversation.threadCursors.delete(previousEnd);
        if (end) {
            conversation.threadEnds.set(key, end);
            if (thread.cursor) conversation.threadCursors.set(end, { source: sourceId, cursor: thread.cursor });
        }
        return added;
    }

    /**
     * Folds one answer of a source's conversation in. usedCursor is the page cursor the answer was
     * asked with, if any. The number of new replies.
     */
    function merge(conversation, sourceId, answer, usedCursor = null) {
        const from = source(conversation, sourceId);
        from.started = true;

        let added = 0;
        for (const thread of answer.threads || []) added += addThread(conversation, sourceId, thread);
        for (const thread of answer.additions || []) added += addThread(conversation, sourceId, thread);

        const usedPage = from.next.find((page) => page.cursor === usedCursor);
        from.next = from.next.filter((page) => page !== usedPage);
        if (usedPage && !(answer.threads || []).length && !(answer.additions || []).length) {
            // X keeps handing out a cursor of the same kind after the last page; an empty page ends it.
            from.next = from.next.filter((page) => page.type !== usedPage.type);
            return added;
        }
        for (const page of answer.next || []) {
            if (!from.next.some((known) => known.cursor === page.cursor)) from.next.push(page);
        }
        return added;
    }

    /** Each loaded reply's children in the order they came, and the post's own replies under its id. */
    function children(conversation) {
        const tree = new Map([[conversation.root.id, []]]);
        for (const id of conversation.order) tree.set(id, []);
        for (const id of conversation.order) {
            const parent = conversation.posts.get(id).inReplyToId;
            const under = parent && parent !== id && tree.has(parent) ? parent : conversation.root.id;
            tree.get(under).push(id);
        }
        return tree;
    }

    /** What more a reply can load: its thread's rest, more of its replies, or its replies at all. */
    function moreAt(conversation, id, tree = children(conversation)) {
        const more = [];
        const thread = conversation.threadCursors.get(id);
        if (thread) more.push({ kind: 'thread', id, source: thread.source, cursor: thread.cursor });

        const own = conversation.sources.get(id);
        if (own?.started) {
            if (own.next.length) more.push({ kind: 'page', id, source: id, cursor: own.next[0].cursor });
        } else if (id === conversation.root.id) {
            more.push({ kind: 'page', id, source: id, cursor: null, first: true });
        } else {
            const post = conversation.posts.get(id);
            const loaded = (tree.get(id) || []).length;
            if (post && post.replyCount > loaded) {
                more.push({ kind: 'page', id, source: id, cursor: null, first: true, remaining: post.replyCount - loaded });
            }
        }
        return more;
    }

    /** The ids under the post, each reply followed by its replies. */
    function depthFirst(conversation, tree = children(conversation)) {
        const order = [];
        const stack = [...(tree.get(conversation.root.id) || [])].reverse();
        while (stack.length) {
            const id = stack.pop();
            order.push(id);
            stack.push(...[...(tree.get(id) || [])].reverse());
        }
        return order;
    }

    /**
     * The next thing Expand all loads. The replies already shown are opened all the way down
     * first, in reading order, and only then the post's next page: a big post shows its leading
     * replies with their conversations rather than a long list of replies without any.
     */
    function nextWork(conversation) {
        return nextWorks(conversation, 1)[0] || null;
    }

    /**
     * Up to count things to load at once, in nextWork's order and each from a different reply.
     * The post's own next page only comes once no branch is left, and alone.
     */
    function nextWorks(conversation, count) {
        const tree = children(conversation);
        const rootWork = () => moreAt(conversation, conversation.root.id, tree).slice(0, 1);
        if (!conversation.sources.get(conversation.root.id)?.started) return rootWork();

        const works = [];
        for (const id of depthFirst(conversation, tree)) {
            const more = moreAt(conversation, id, tree);
            if (more.length) works.push(more[0]);
            if (works.length >= count) break;
        }
        return works.length ? works : rootWork();
    }

    root.XPT_REPLY_TREE = { createConversation, merge, children, moreAt, nextWork, nextWorks };
})(typeof module !== 'undefined' && module.exports ? module.exports : globalThis);
