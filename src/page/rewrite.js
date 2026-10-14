/*
 * Rewrites what x.com sends and asks for. Pure functions over the GraphQL / REST JSON and the HLS
 * playlists, so they run the same in the page and under node's test runner.
 *
 * Timelines are lists of instructions holding entries; an entry is an item (a post, account,
 * trend...) or a module of items. Filtering drops entries and module items before the site sees
 * them, the way the Android patches drop items before they reach the timeline database.
 */
(function (root) {
    'use strict';

    const { on, opt, onOpt } = (typeof module !== 'undefined' && module.exports)
        ? require('../shared/catalogue.js').XPT_CATALOGUE
        : root.XPT_CATALOGUE;

    const X_HOST = /^(?:[a-z0-9-]+\.)*(?:x|twitter)\.com$/i;
    const SUGGESTED_MODULE = /^(?:who-to-follow|who-to-subscribe|communities-to-join)-/;

    // region Classification

    /** 'api' for x.com API calls, 'm3u8' for video playlists, else null. */
    function classify(url) {
        const u = parse(url);
        if (!u) return null;
        if (u.hostname === 'video.twimg.com' && u.pathname.endsWith('.m3u8')) return 'm3u8';
        if (X_HOST.test(u.hostname) && /^\/(?:i\/api\/|1\.1\/|2\/|graphql\/)/.test(u.pathname)) return 'api';
        return null;
    }

    /** The GraphQL operation name, e.g. HomeTimeline, or ''. */
    function operation(url) {
        const u = parse(url);
        if (!u || !u.pathname.includes('/graphql/')) return '';
        return u.pathname.split('/').pop();
    }

    function parse(url) {
        try {
            return new URL(url, 'https://x.com/');
        } catch {
            return null;
        }
    }

    // endregion

    // region Requests

    /**
     * The URL a GraphQL request is sent to, with its variables and features rewritten.
     * ctx.sorted holds the conversations already opened with the chosen reply sort, so a sort the
     * user picks afterwards is left alone.
     */
    function rewriteRequestUrl(url, settings, ctx = {}) {
        const u = parse(url);
        if (!u || !u.pathname.includes('/graphql/')) return url;

        const op = u.pathname.split('/').pop();
        let changed = false;

        const variables = readJson(u.searchParams.get('variables'));
        if (variables && rewriteVariables(op, variables, settings, ctx)) {
            u.searchParams.set('variables', JSON.stringify(variables));
            changed = true;
        }

        const features = readJson(u.searchParams.get('features'));
        if (features && rewriteFeatures(features, settings)) {
            u.searchParams.set('features', JSON.stringify(features));
            changed = true;
        }

        return changed ? u.toString() : url;
    }

    /** A GraphQL POST body, with its variables and features rewritten. */
    function rewriteRequestBody(url, body, settings, ctx = {}) {
        if (typeof body !== 'string' || body[0] !== '{') return body;

        const json = readJson(body);
        if (!json) return body;

        let changed = false;
        if (json.variables && typeof json.variables === 'object') {
            changed = rewriteVariables(operation(url), json.variables, settings, ctx) || changed;
        }
        if (json.features && typeof json.features === 'object') {
            changed = rewriteFeatures(json.features, settings) || changed;
        }
        return changed ? JSON.stringify(json) : body;
    }

    function rewriteVariables(op, variables, settings, ctx) {
        let changed = false;

        if (on(settings, 'removeAds') && variables.includePromotedContent === true) {
            variables.includePromotedContent = false;
            changed = true;
        }

        const sort = onOpt(settings, 'replySort', 'sort');
        if (sort && op === 'TweetDetail' && variables.focalTweetId && !variables.cursor && ctx.sorted &&
            !ctx.sorted.has(variables.focalTweetId)) {
            ctx.sorted.add(variables.focalTweetId);
            if (variables.rankingMode !== sort) {
                variables.rankingMode = sort;
                changed = true;
            }
        }

        return changed;
    }

    /** Overrides the request's feature flags that Hook feature flag sets. Only flags already sent. */
    function rewriteFeatures(features, settings) {
        if (!on(settings, 'hookFeatureFlag')) return false;

        let changed = false;
        for (const [key, value] of parseFlags(opt(settings, 'hookFeatureFlag', 'flags'))) {
            if (key in features && features[key] !== value) {
                features[key] = value;
                changed = true;
            }
        }
        return changed;
    }

    /** key=value lines as [key, value] pairs; values are JSON where they parse, else text. */
    function parseFlags(lines) {
        const flags = [];
        for (const line of lines || []) {
            const index = line.indexOf('=');
            if (index <= 0) continue;

            const key = line.slice(0, index).trim();
            const raw = line.slice(index + 1).trim();
            if (!key) continue;

            let value = raw;
            try {
                value = JSON.parse(raw);
            } catch {
                // Plain text.
            }
            flags.push([key, value]);
        }
        return flags;
    }

    // endregion

    // region Responses

    /**
     * The response text the site gets. store, when given, is handed every post seen
     * (store.add(tweet)) and every t.co link resolved (store.link(short, expanded)).
     */
    function transformResponse(url, text, settings, store) {
        const kind = classify(url);
        if (kind === 'm3u8') return on(settings, 'forceHdVideos') ? keepBestVariant(text) : text;
        if (kind !== 'api' || typeof text !== 'string') return text;

        const first = text.trimStart()[0];
        if (first !== '{' && first !== '[') return text;

        const json = readJson(text);
        if (!json) return text;

        return transformJson(url, json, settings, store) ? JSON.stringify(json) : text;
    }

    /** Rewrites a parsed response in place. True if anything changed. */
    function transformJson(url, json, settings, store) {
        const u = parse(url);
        const path = u ? u.pathname : '';
        const op = operation(url);
        let changed = false;

        if (path.endsWith('/search/typeahead.json')) changed = typeahead(json, settings) || changed;
        if (op === 'ExplorePage') changed = exploreTabs(json, settings) || changed;
        if (op === 'PinnedTimelines') changed = pinnedTimelines(json, settings) || changed;
        if ((op === 'ViewerBadgeCounts' || path.endsWith('/badge_count/badge_count.json')) && on(settings, 'hideNavBadges')) {
            changed = zeroCounts(json) || changed;
        }

        const filters = timelineFilters(settings, op === 'TweetDetail' ? focalTweetId(u) : null);
        const links = new Map();
        const cards = [];

        walk(json, (object) => {
            if (filters.any && Array.isArray(object.instructions)) {
                changed = filterInstructions(object.instructions, filters) || changed;
            }

            if (object.__typename === 'TweetWithVisibilityResults' && object.mediaVisibilityResults &&
                on(settings, 'showSensitiveMedia')) {
                delete object.mediaVisibilityResults;
                changed = true;
            }

            // A typed post is met on its own; an untyped one only through its wrapper.
            const wrapped = wrappedTweet(object);
            const post = isTweet(object) ? object : wrapped && wrapped.__typename === undefined ? wrapped : null;
            if (post) {
                store?.add?.(post);
                changed = transformTweet(post, settings) || changed;
                if (post.card?.legacy) cards.push(post.card.legacy);
            }

            if (typeof object.url === 'string' && object.url.startsWith('https://t.co/') &&
                typeof object.expanded_url === 'string' && object.expanded_url) {
                links.set(object.url, object.expanded_url);
                store?.link?.(object.url, object.expanded_url);
                if (on(settings, 'noShortenedUrl')) {
                    object.url = object.expanded_url;
                    changed = true;
                }
            }
        });

        if (on(settings, 'noShortenedUrl') && links.size) {
            for (const card of cards) changed = expandCardLinks(card, links) || changed;
        }

        return changed;
    }

    function focalTweetId(u) {
        const variables = u && readJson(u.searchParams.get('variables'));
        return variables?.focalTweetId || null;
    }

    // endregion

    // region Timeline filters

    function timelineFilters(settings, focalId) {
        const keywords = lower(onOpt(settings, 'filterByKeyword', 'keywords'));
        const feed = on(settings, 'feedFilters');
        const filters = {
            focalId,
            ads: on(settings, 'removeAds'),
            keywords,
            mediaOnly: feed && opt(settings, 'feedFilters', 'mediaOnly') === true,
            hideFollowed: feed && opt(settings, 'feedFilters', 'hideFollowed') === true,
            hideSuggested: feed && opt(settings, 'feedFilters', 'hideSuggested') === true,
            include: feed ? lower(opt(settings, 'feedFilters', 'includeKeywords')) : [],
        };
        filters.any = filters.ads || filters.keywords.length > 0 || filters.mediaOnly || filters.hideFollowed ||
            filters.hideSuggested || filters.include.length > 0;
        return filters;
    }

    function lower(lines) {
        const keywords = [];
        for (const line of lines || []) {
            const keyword = String(line).trim().toLowerCase();
            if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
        }
        return keywords;
    }

    function filterInstructions(instructions, filters) {
        let changed = false;

        for (let index = instructions.length - 1; index >= 0; index--) {
            const instruction = instructions[index];
            if (!instruction || typeof instruction !== 'object') continue;

            if (Array.isArray(instruction.entries)) {
                const kept = instruction.entries.filter((entry) => keepEntry(entry, filters));
                if (kept.length !== instruction.entries.length) {
                    instruction.entries = kept;
                    changed = true;
                }
            }

            if (Array.isArray(instruction.moduleItems)) {
                const kept = instruction.moduleItems.filter((item) => !dropItem(item?.item?.itemContent, item?.entryId, filters));
                if (kept.length !== instruction.moduleItems.length) {
                    instruction.moduleItems = kept;
                    changed = true;
                }
            }

            if (instruction.type === 'TimelinePinEntry' && instruction.entry && !keepEntry(instruction.entry, filters)) {
                instructions.splice(index, 1);
                changed = true;
            }
        }

        return changed;
    }

    function keepEntry(entry, filters) {
        const content = entry?.content;
        if (!content) return true;

        const type = content.entryType || content.__typename;
        if (type === 'TimelineTimelineItem') return !dropItem(content.itemContent, entry.entryId, filters);

        if (type === 'TimelineTimelineModule') {
            const id = entry.entryId || '';
            if (filters.hideSuggested && SUGGESTED_MODULE.test(id)) return false;
            if (filters.ads && /^promoted/i.test(id)) return false;

            if (Array.isArray(content.items) && content.items.length) {
                const kept = content.items.filter((item) => !dropItem(item?.item?.itemContent, item?.entryId, filters));
                if (!kept.length) return false;
                content.items = kept;
            }
        }

        return true;
    }

    /** If a timeline item is left out. */
    function dropItem(itemContent, entryId, filters) {
        if (!itemContent || typeof itemContent !== 'object') return false;

        if (filters.ads && (itemContent.promotedMetadata || itemContent.promoted_metadata || /^promoted/i.test(entryId || ''))) {
            return true;
        }

        const post = unwrapTweet(itemContent.tweet_results?.result);
        if (!post) return false;

        // The post a conversation is opened on always stays.
        if (filters.focalId && post.rest_id === filters.focalId) return false;

        const original = retweeted(post) || post;
        const text = unescapeHtml(tweetText(original)).toLowerCase();

        if (filters.keywords.some((keyword) => text.includes(keyword))) return true;
        if (filters.mediaOnly && !hasMedia(original)) return true;
        if (filters.hideFollowed && (isFollowed(post) || isFollowed(original))) return true;
        if (filters.include.length && !filters.include.some((keyword) => text.includes(keyword))) return true;

        return false;
    }

    // endregion

    // region Posts

    function isTweet(object) {
        return object.__typename === 'Tweet' && typeof object.rest_id === 'string' && object.legacy && typeof object.legacy === 'object';
    }

    /** The post inside a visibility wrapper, which comes without a __typename of its own. */
    function wrappedTweet(object) {
        if (object?.__typename !== 'TweetWithVisibilityResults') return null;
        const inner = object.tweet;
        if (!inner || typeof inner !== 'object' || typeof inner.rest_id !== 'string' || !inner.legacy || typeof inner.legacy !== 'object') return null;
        return inner.__typename === undefined || inner.__typename === 'Tweet' ? inner : null;
    }

    /** A post from a tweet result, through its visibility wrapper. Tombstones and the like are null. */
    function unwrapTweet(result) {
        if (!result || typeof result !== 'object') return null;
        if (result.__typename === 'TweetWithVisibilityResults') return wrappedTweet(result);
        return isTweet(result) ? result : null;
    }

    function retweeted(post) {
        return unwrapTweet(post?.legacy?.retweeted_status_result?.result);
    }

    function tweetText(post) {
        return post?.note_tweet?.note_tweet_results?.result?.text ?? post?.legacy?.full_text ?? '';
    }

    /**
     * A post's text as it reads: long posts in full, links at their real address, and without the
     * leading reply mentions or the trailing link to its own media. full_text is HTML escaped and
     * its entity indices count code points of the unescaped text.
     */
    function readableText(post) {
        const note = post?.note_tweet?.note_tweet_results?.result?.text;
        if (typeof note === 'string') return note;

        const legacy = post?.legacy;
        const chars = Array.from(unescapeHtml(legacy?.full_text ?? ''));
        const [start, end] = Array.isArray(legacy?.display_text_range) ? legacy.display_text_range : [0, chars.length];

        const replacements = [];
        for (const link of legacy?.entities?.urls || []) {
            if (Array.isArray(link?.indices) && link.expanded_url) replacements.push([link.indices[0], link.indices[1], link.expanded_url]);
        }
        for (const media of legacy?.entities?.media || []) {
            if (Array.isArray(media?.indices)) replacements.push([media.indices[0], media.indices[1], '']);
        }
        replacements.sort((a, b) => a[0] - b[0]);

        let text = '';
        let position = start;
        for (const [from, to, value] of replacements) {
            if (from < position || to > end) continue;
            text += chars.slice(position, from).join('') + value;
            position = to;
        }
        text += chars.slice(position, end).join('');
        return text.trim();
    }

    function unescapeHtml(text) {
        return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }

    function hasMedia(post) {
        return (post?.legacy?.extended_entities?.media?.length || 0) > 0;
    }

    function isFollowed(post) {
        const user = post?.core?.user_results?.result;
        return user?.relationship_perspectives?.following === true || user?.legacy?.following === true;
    }

    function transformTweet(post, settings) {
        let changed = false;

        if (on(settings, 'hideCommunityNotes') && post.birdwatch_pivot) {
            delete post.birdwatch_pivot;
            changed = true;
        }

        if (on(settings, 'showSensitiveMedia')) {
            if (post.legacy.possibly_sensitive) {
                post.legacy.possibly_sensitive = false;
                changed = true;
            }
            const media = [...(post.legacy.extended_entities?.media || []), ...(post.legacy.entities?.media || [])];
            for (const item of media) {
                for (const key of ['sensitive_media_warning', 'ext_sensitive_media_warning']) {
                    if (item && key in item) {
                        delete item[key];
                        changed = true;
                    }
                }
            }
        }

        if (on(settings, 'forceTranslate') && post.is_translatable !== true) {
            post.is_translatable = true;
            changed = true;
        }

        if (on(settings, 'showPollResults') && /^poll\d+choice/.test(post.card?.legacy?.name || '')) {
            changed = setBinding(post.card.legacy, 'counts_are_final', { boolean_value: true, type: 'BOOLEAN' }) || changed;
        }

        return changed;
    }

    /** Sets a card binding value, in either shape the API uses: a key/value list or an object. */
    function setBinding(card, key, value) {
        const bindings = card.binding_values;
        if (Array.isArray(bindings)) {
            const binding = bindings.find((item) => item?.key === key);
            if (binding) {
                if (binding.value?.boolean_value === value.boolean_value) return false;
                binding.value = value;
            } else {
                bindings.push({ key, value });
            }
            return true;
        }
        if (bindings && typeof bindings === 'object') {
            if (bindings[key]?.boolean_value === value.boolean_value) return false;
            bindings[key] = value;
            return true;
        }
        return false;
    }

    /** Points a link card at the expanded address of its t.co link, when the post resolved it. */
    function expandCardLinks(card, links) {
        let changed = false;

        if (links.has(card.url)) {
            card.url = links.get(card.url);
            changed = true;
        }

        const bindings = Array.isArray(card.binding_values)
            ? card.binding_values.map((item) => item?.value)
            : Object.values(card.binding_values || {});
        for (const value of bindings) {
            if (value && typeof value.string_value === 'string' && links.has(value.string_value)) {
                value.string_value = links.get(value.string_value);
                changed = true;
            }
        }

        return changed;
    }

    /**
     * What the UI needs of a post: author, text and the best link of each photo, video and GIF.
     * Photos at their original size, videos and GIFs at their highest bitrate mp4.
     */
    function summarize(post) {
        const user = post.core?.user_results?.result;
        const original = retweeted(post);
        return {
            id: post.rest_id,
            screenName: user?.core?.screen_name || user?.legacy?.screen_name || '',
            name: user?.core?.name || user?.legacy?.name || '',
            avatar: user?.avatar?.image_url || user?.legacy?.profile_image_url_https || '',
            verified: user?.is_blue_verified === true,
            author: {
                id: user?.rest_id || '',
                following: user?.relationship_perspectives?.following === true || user?.legacy?.following === true,
                followRequestSent: user?.follow_request_sent === true || user?.legacy?.follow_request_sent === true,
                blocking: user?.relationship_perspectives?.blocking === true,
                blockedBy: user?.relationship_perspectives?.blocked_by === true,
            },
            text: readableText(post),
            createdAt: post.legacy?.created_at || '',
            inReplyToId: post.legacy?.in_reply_to_status_id_str || null,
            replyCount: post.legacy?.reply_count || 0,
            retweetCount: post.legacy?.retweet_count || 0,
            likeCount: post.legacy?.favorite_count || 0,
            media: mediaOf(post),
            quotedId: unwrapTweet(post.quoted_status_result?.result)?.rest_id || null,
            retweetedId: original?.rest_id || null,
        };
    }

    function mediaOf(post) {
        const media = [];
        for (const item of post.legacy?.extended_entities?.media || []) {
            if (item?.type === 'photo' && item.media_url_https) {
                const match = item.media_url_https.match(/^(.*)\.(\w+)$/);
                const base = match ? match[1] : item.media_url_https;
                const ext = match ? match[2] : 'jpg';
                media.push({
                    type: 'photo',
                    url: `${base}?format=${ext}&name=orig`,
                    ext,
                    preview: `${base}?format=${ext}&name=small`,
                });
            } else if (item?.video_info?.variants) {
                let best = null;
                for (const variant of item.video_info.variants) {
                    if (variant?.content_type !== 'video/mp4' || !variant.url) continue;
                    if (!best || (variant.bitrate || 0) > (best.bitrate || 0)) best = variant;
                }
                if (best) {
                    media.push({ type: item.type === 'animated_gif' ? 'gif' : 'video', url: best.url, ext: 'mp4', preview: item.media_url_https || '' });
                }
            }
        }
        return media;
    }

    // endregion

    // region Conversations

    const NEXT_CURSORS = new Set(['Bottom', 'ShowMoreThreads', 'ShowMoreThreadsPrompt']);

    /**
     * The replies in a TweetDetail response, for showing them under a post: reply threads in
     * order, each with the cursor that loads more of it, posts added to threads already shown,
     * and the cursors of further pages. Ancestors, the post itself, related posts and the like
     * are left out.
     */
    function parseConversation(json, focalId) {
        const result = { threads: [], additions: [], next: [] };
        const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions;
        if (!Array.isArray(instructions)) return result;

        const readItems = (items) => {
            const posts = [];
            let cursor = null;
            for (const item of items || []) {
                const content = item?.item?.itemContent;
                if (content?.__typename === 'TimelineTimelineCursor' || content?.itemType === 'TimelineTimelineCursor') {
                    if (content.value) cursor = content.value;
                    continue;
                }
                const post = unwrapTweet(content?.tweet_results?.result);
                if (post && post.rest_id !== focalId) posts.push(post);
            }
            return { posts, cursor };
        };

        for (const instruction of instructions) {
            if (instruction?.type === 'TimelineAddToModule' && instruction.moduleEntryId) {
                result.additions.push({ id: instruction.moduleEntryId, ...readItems(instruction.moduleItems) });
                continue;
            }
            for (const entry of instruction?.entries || []) {
                const content = entry?.content;
                const id = entry?.entryId || '';
                if (id.startsWith('conversationthread-') && Array.isArray(content?.items)) {
                    const thread = readItems(content.items);
                    if (thread.posts.length || thread.cursor) result.threads.push({ id, ...thread });
                } else if (content?.cursorType && NEXT_CURSORS.has(content.cursorType) && content.value) {
                    result.next.push({ cursor: content.value, type: content.cursorType });
                } else if (content?.itemContent?.__typename === 'TimelineTimelineCursor' &&
                    NEXT_CURSORS.has(content.itemContent.cursorType) && content.itemContent.value) {
                    result.next.push({ cursor: content.itemContent.value, type: content.itemContent.cursorType });
                }
            }
        }

        // The next page first, then the replies the site tucks away.
        result.next.sort((a, b) => (a.type === 'Bottom' ? 0 : 1) - (b.type === 'Bottom' ? 0 : 1));
        return result;
    }

    // endregion

    // region Single responses

    function typeahead(json, settings) {
        let changed = false;
        if (onOpt(settings, 'searchSuggestions', 'hideUsers') === true && Array.isArray(json.users) && json.users.length) {
            json.users = [];
            changed = true;
        }
        if (onOpt(settings, 'searchSuggestions', 'hideSuggestions') === true && Array.isArray(json.topics) && json.topics.length) {
            json.topics = [];
            changed = true;
        }
        return changed;
    }

    /** Drops the hidden tabs from the Explore page. One tab always stays. */
    function exploreTabs(json, settings) {
        const hidden = (onOpt(settings, 'exploreTabs', 'hidden') || []).map(normalise).filter(Boolean);
        const body = json?.data?.explore_page?.body;
        if (!hidden.length || !Array.isArray(body?.timelines)) return false;

        const kept = body.timelines.filter((tab) => !hidden.includes(normalise(tab?.id)));
        if (!kept.length || kept.length === body.timelines.length) return false;
        body.timelines = kept;
        return true;
    }

    /** Drops the hidden kinds of pinned timeline from the home top bar. */
    function pinnedTimelines(json, settings) {
        if (!on(settings, 'homeTabs')) return false;

        const hidden = new Set();
        if (opt(settings, 'homeTabs', 'hidePinnedLists')) hidden.add('ListPinnedTimeline');
        if (opt(settings, 'homeTabs', 'hidePinnedCommunities')) hidden.add('CommunityPinnedTimeline');
        if (opt(settings, 'homeTabs', 'hidePinnedTopics')) {
            hidden.add('TopicPinnedTimeline');
            hidden.add('GenericPinnedTimeline');
        }

        const holder = json?.data?.pinned_timelines;
        if (!hidden.size || !Array.isArray(holder?.pinned_timelines)) return false;

        const kept = holder.pinned_timelines.filter((timeline) => !hidden.has(timeline?.__typename));
        if (kept.length === holder.pinned_timelines.length) return false;
        holder.pinned_timelines = kept;
        return true;
    }

    /** Sets every unread count in a badge count response to zero. */
    function zeroCounts(json) {
        let changed = false;
        walk(json, (object) => {
            for (const [key, value] of Object.entries(object)) {
                if (typeof value === 'number' && value !== 0 && /count/i.test(key)) {
                    object[key] = 0;
                    changed = true;
                }
            }
        });
        return changed;
    }

    function normalise(key) {
        return String(key ?? '').toLowerCase().replace(/[_-]/g, '');
    }

    // endregion

    // region HLS

    /** A master playlist that offers only its highest bandwidth video stream. */
    function keepBestVariant(text) {
        if (typeof text !== 'string' || !text.includes('#EXT-X-STREAM-INF')) return text;

        const lines = text.split(/\r?\n/);
        const streams = [];
        for (let index = 0; index < lines.length; index++) {
            if (!lines[index].startsWith('#EXT-X-STREAM-INF')) continue;

            let uri = index + 1;
            while (uri < lines.length && (lines[uri].startsWith('#') || !lines[uri].trim())) uri++;
            if (uri >= lines.length) continue;

            const bandwidth = Number((lines[index].match(/[:,]BANDWIDTH=(\d+)/) || [])[1] || 0);
            const resolution = lines[index].match(/RESOLUTION=(\d+)x(\d+)/);
            const pixels = resolution ? Number(resolution[1]) * Number(resolution[2]) : 0;
            streams.push({ index, uri, bandwidth, pixels });
        }
        if (streams.length < 2) return text;

        const best = streams.reduce((top, stream) =>
            stream.pixels > top.pixels || (stream.pixels === top.pixels && stream.bandwidth > top.bandwidth) ? stream : top);

        const dropped = new Set();
        for (const stream of streams) {
            if (stream === best) continue;
            dropped.add(stream.index);
            dropped.add(stream.uri);
        }
        return lines.filter((_, index) => !dropped.has(index)).join('\n');
    }

    // endregion

    // region Initial state

    /** Boolean switches that look like upsells but are not. */
    const NOT_UPSELLS = /_fix_enabled$|_eligibility_query_enabled$|_track_interactions_enabled$/;

    /** Upsell switches that do not say upsell. */
    const UPSELLS_OFF = [
        'premium_paywall_on_app_load_enabled',
        'premium_paywall_on_app_load_journey_enabled',
        'gryphon_upgrade_premium_plus_banner_enabled',
        'responsive_web_user_badge_education_get_verified_button_enabled',
        'responsive_web_verified_organizations_free_upgrade_promo_enabled',
        'vo_upsell_enabled',
    ];

    /**
     * Rewrites the feature switches and settings the page boots with, window.__INITIAL_STATE__.
     * Every switch lives in defaultConfig and in the user's config; both are set.
     */
    function patchInitialState(state, settings) {
        const switches = state?.featureSwitch;
        const configs = [switches?.defaultConfig, switches?.user?.config].filter((config) => config && typeof config === 'object');
        let changed = false;

        const set = (key, value) => {
            for (const config of configs) {
                const current = config[key];
                if (current && typeof current === 'object') {
                    if (current.value !== value) {
                        config[key] = { ...current, value };
                        changed = true;
                    }
                } else {
                    config[key] = { value };
                    changed = true;
                }
            }
        };
        const keys = (test) => {
            const found = new Set();
            for (const config of configs) {
                for (const [key, entry] of Object.entries(config)) {
                    if (typeof entry?.value === 'boolean' && test(key)) found.add(key);
                }
            }
            return found;
        };

        if (on(settings, 'removePremiumUpsell')) {
            for (const key of keys((key) => /upsell/.test(key) && !NOT_UPSELLS.test(key))) set(key, false);
            for (const key of UPSELLS_OFF) set(key, false);
            set('premium_business_offers_navbar_premium_signup_hidden', true);
        }

        if (on(settings, 'unlockPremium')) {
            for (const key of keys((key) => /^subscriptions_feature_/.test(key))) set(key, true);
        }

        if (on(settings, 'nativeDownloader')) {
            set('responsive_web_media_download_video_share_menu_enabled', true);
        }

        if (on(settings, 'hookFeatureFlag')) {
            for (const [key, value] of parseFlags(opt(settings, 'hookFeatureFlag', 'flags'))) set(key, value);
        }

        const remote = state?.settings?.remote?.settings;
        if (on(settings, 'showSensitiveMedia') && remote && remote.display_sensitive_media !== true) {
            remote.display_sensitive_media = true;
            changed = true;
        }

        return changed;
    }

    // endregion

    // region Links

    const X_LINK = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//gi;
    const ANONYMOUS_STATUS = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/i\/(?:web\/)?status\/(\d+)/gi;

    /**
     * Text the site shares or copies. Legacy share links names the author in post links; Custom
     * sharing domain points x.com links at the chosen domain. screenNameOf(id) looks up authors.
     */
    function transformShareText(text, settings, screenNameOf) {
        if (typeof text !== 'string' || !text) return text;

        let result = text;
        if (on(settings, 'legacyShareLinks') && screenNameOf) {
            result = result.replace(ANONYMOUS_STATUS, (link, id) => {
                const screenName = screenNameOf(id);
                return screenName ? `https://x.com/${screenName}/status/${id}` : link;
            });
        }

        const domain = (onOpt(settings, 'customSharingDomain', 'domain') || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        if (domain && /^[a-z0-9.-]+(?::\d+)?$/i.test(domain)) {
            result = result.replace(X_LINK, `https://${domain}/`);
        }
        return result;
    }

    // endregion

    /** Visits every object in a JSON value, parents before children. */
    function walk(value, visit) {
        const stack = [value];
        while (stack.length) {
            const current = stack.pop();
            if (!current || typeof current !== 'object') continue;

            if (Array.isArray(current)) {
                for (let index = current.length - 1; index >= 0; index--) stack.push(current[index]);
                continue;
            }

            visit(current);
            for (const key in current) {
                const child = current[key];
                if (child && typeof child === 'object') stack.push(child);
            }
        }
    }

    function readJson(text) {
        if (typeof text !== 'string' || !text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    root.XPT_REWRITE = {
        classify,
        operation,
        rewriteRequestUrl,
        rewriteRequestBody,
        parseFlags,
        transformResponse,
        transformJson,
        summarize,
        parseConversation,
        unwrapTweet,
        keepBestVariant,
        patchInitialState,
        transformShareText,
    };
})(typeof module !== 'undefined' && module.exports ? module.exports : globalThis);
