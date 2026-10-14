'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { XPT_CATALOGUE: catalogue } = require('../src/shared/catalogue.js');
const { XPT_REWRITE: R } = require('../src/page/rewrite.js');

const HOME = 'https://x.com/i/api/graphql/abc/HomeTimeline?variables=%7B%22count%22%3A20%7D';

function settingsWith(changes = {}) {
    const settings = catalogue.defaults();
    for (const id of Object.keys(settings.patches)) settings.patches[id] = false;
    for (const [id, value] of Object.entries(changes)) {
        settings.patches[id] = true;
        if (value && typeof value === 'object') Object.assign(settings.options[id], value);
    }
    return settings;
}

function user({ screenName = 'someone', following = false } = {}) {
    return {
        __typename: 'User',
        rest_id: '1',
        core: { name: 'Some One', screen_name: screenName },
        avatar: { image_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' },
        relationship_perspectives: { following },
    };
}

function tweet(id, { text = 'hello', media, following, card, extra } = {}) {
    return {
        __typename: 'Tweet',
        rest_id: id,
        core: { user_results: { result: user({ following }) } },
        is_translatable: false,
        legacy: {
            full_text: text,
            created_at: 'Tue Oct 14 10:00:00 +0000 2026',
            possibly_sensitive: false,
            entities: { urls: [] },
            ...(media ? { extended_entities: { media } } : {}),
        },
        ...(card ? { card } : {}),
        ...extra,
    };
}

function item(entryId, result, itemExtra = {}) {
    return {
        entryId,
        content: {
            entryType: 'TimelineTimelineItem',
            __typename: 'TimelineTimelineItem',
            itemContent: { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result }, ...itemExtra },
        },
    };
}

function timeline(entries) {
    return { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } };
}

function entriesOf(json) {
    return json.data.home.home_timeline_urt.instructions[0].entries.map((entry) => entry.entryId);
}

function run(url, json, settings, store) {
    return JSON.parse(R.transformResponse(url, JSON.stringify(json), settings, store));
}

const photo = { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/ABC.jpg' };

// region Classification

test('classifies API calls and playlists', () => {
    assert.equal(R.classify(HOME), 'api');
    assert.equal(R.classify('https://x.com/i/api/1.1/search/typeahead.json?q=a'), 'api');
    assert.equal(R.classify('https://api.x.com/1.1/graphql/viewer_context.json'), 'api');
    assert.equal(R.classify('https://video.twimg.com/amplify_video/1/pl/abc.m3u8'), 'm3u8');
    assert.equal(R.classify('https://x.com/home'), null);
    assert.equal(R.classify('https://example.com/i/api/x'), null);
    assert.equal(R.operation(HOME), 'HomeTimeline');
});

// endregion

// region Filters

test('Remove Ads drops promoted entries', () => {
    const json = timeline([
        item('tweet-1', tweet('1')),
        item('promoted-tweet-2-abc', tweet('2'), { promotedMetadata: { impressionId: 'x' } }),
        { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor' } },
    ]);
    assert.deepEqual(entriesOf(run(HOME, json, settingsWith({ removeAds: true }))), ['tweet-1', 'cursor-bottom-1']);
    assert.deepEqual(entriesOf(run(HOME, json, settingsWith())), ['tweet-1', 'promoted-tweet-2-abc', 'cursor-bottom-1']);
});

test('Remove Ads asks the server for no promoted content', () => {
    const url = 'https://x.com/i/api/graphql/abc/HomeTimeline?variables=' +
        encodeURIComponent(JSON.stringify({ count: 20, includePromotedContent: true }));
    const out = new URL(R.rewriteRequestUrl(url, settingsWith({ removeAds: true })));
    assert.equal(JSON.parse(out.searchParams.get('variables')).includePromotedContent, false);
    assert.equal(R.rewriteRequestUrl(url, settingsWith()), url);
});

test('Filter posts by keyword ignores case and reads long posts', () => {
    const long = tweet('2', { text: 'short' });
    long.note_tweet = { note_tweet_results: { result: { text: 'a long SPOILER post' } } };
    const json = timeline([item('tweet-1', tweet('1', { text: 'fine' })), item('tweet-2', long)]);
    const out = run(HOME, json, settingsWith({ filterByKeyword: { keywords: ['spoiler'] } }));
    assert.deepEqual(entriesOf(out), ['tweet-1']);
});

test('Feed filters: media only, hide followed, include keywords', () => {
    const json = () => timeline([
        item('tweet-1', tweet('1', { text: 'cat picture', media: [photo] })),
        item('tweet-2', tweet('2', { text: 'dog text' })),
        item('tweet-3', tweet('3', { text: 'cat text', following: true })),
    ]);

    assert.deepEqual(entriesOf(run(HOME, json(), settingsWith({ feedFilters: { mediaOnly: true } }))), ['tweet-1']);
    assert.deepEqual(entriesOf(run(HOME, json(), settingsWith({ feedFilters: { hideFollowed: true } }))), ['tweet-1', 'tweet-2']);
    assert.deepEqual(entriesOf(run(HOME, json(), settingsWith({ feedFilters: { includeKeywords: ['CAT'] } }))), ['tweet-1', 'tweet-3']);
});

test('Feed filters look through retweets and visibility wrappers', () => {
    const retweet = tweet('10', { text: 'RT @a: cat' });
    retweet.legacy.retweeted_status_result = { result: tweet('11', { text: 'cat', media: [photo] }) };
    const wrapped = { __typename: 'TweetWithVisibilityResults', tweet: tweet('12', { text: 'no media' }) };
    const json = timeline([item('tweet-10', retweet), item('tweet-12', wrapped)]);
    assert.deepEqual(entriesOf(run(HOME, json, settingsWith({ feedFilters: { mediaOnly: true } }))), ['tweet-10']);
});

test('posts in a visibility wrapper, which carry no __typename, are filtered and rewritten', () => {
    const inner = () => {
        const post = tweet('30', { text: 'followed', following: true, media: [{ ...photo, sensitive_media_warning: {} }] });
        delete post.__typename;
        return post;
    };
    const wrapped = () => ({ __typename: 'TweetWithVisibilityResults', limitedActionResults: {}, tweet: inner() });

    const filtered = run(HOME, timeline([item('tweet-30', wrapped()), item('tweet-1', tweet('1'))]), settingsWith({ feedFilters: { hideFollowed: true } }));
    assert.deepEqual(entriesOf(filtered), ['tweet-1']);

    const seen = [];
    const out = run(HOME, timeline([item('tweet-30', wrapped())]), settingsWith({ showSensitiveMedia: true }), { add: (p) => seen.push(p.rest_id), link() {} });
    const post = out.data.home.home_timeline_urt.instructions[0].entries[0].content.itemContent.tweet_results.result.tweet;
    assert.equal(post.legacy.extended_entities.media[0].sensitive_media_warning, undefined);
    assert.equal(post.__typename, undefined, 'the wrapper post is not given a type it did not have');
    assert.deepEqual(seen, ['30']);
});

test('Feed filters hide suggestion modules and keep others', () => {
    const module = (entryId) => ({
        entryId,
        content: { entryType: 'TimelineTimelineModule', items: [{ entryId: `${entryId}-u`, item: { itemContent: { __typename: 'TimelineUser' } } }] },
    });
    const json = timeline([module('who-to-follow-1'), module('toptabsrpusermodule-1'), item('tweet-1', tweet('1'))]);
    const out = run(HOME, json, settingsWith({ feedFilters: { hideSuggested: true } }));
    assert.deepEqual(entriesOf(out), ['toptabsrpusermodule-1', 'tweet-1']);
});

test('modules lose filtered items and go when empty', () => {
    const conversation = {
        entryId: 'conversationthread-1',
        content: {
            entryType: 'TimelineTimelineModule',
            items: [
                { entryId: 'c-1', item: { itemContent: { tweet_results: { result: tweet('21', { text: 'spoiler' }) } } } },
                { entryId: 'c-2', item: { itemContent: { tweet_results: { result: tweet('22', { text: 'ok' }) } } } },
            ],
        },
    };
    const only = {
        entryId: 'conversationthread-2',
        content: { entryType: 'TimelineTimelineModule', items: [{ entryId: 'c-3', item: { itemContent: { tweet_results: { result: tweet('23', { text: 'spoiler' }) } } } }] },
    };
    const out = run(HOME, timeline([conversation, only]), settingsWith({ filterByKeyword: { keywords: ['spoiler'] } }));
    const entries = out.data.home.home_timeline_urt.instructions[0].entries;
    assert.deepEqual(entries.map((entry) => entry.entryId), ['conversationthread-1']);
    assert.deepEqual(entries[0].content.items.map((it) => it.entryId), ['c-2']);
});

test('the focal post of a conversation is never filtered', () => {
    const url = 'https://x.com/i/api/graphql/abc/TweetDetail?variables=' + encodeURIComponent(JSON.stringify({ focalTweetId: '5' }));
    const json = {
        data: {
            threaded_conversation_with_injections_v2: {
                instructions: [{ type: 'TimelineAddEntries', entries: [item('tweet-5', tweet('5', { text: 'no media' })), item('tweet-6', tweet('6'))] }],
            },
        },
    };
    const out = run(url, json, settingsWith({ feedFilters: { mediaOnly: true } }));
    assert.deepEqual(out.data.threaded_conversation_with_injections_v2.instructions[0].entries.map((e) => e.entryId), ['tweet-5']);
});

// endregion

// region Posts

test('post transforms: notes, sensitive media, translate, polls', () => {
    const poll = {
        legacy: {
            name: 'poll2choice_text_only',
            binding_values: [{ key: 'choice1_count', value: { string_value: '3', type: 'STRING' } },
                { key: 'counts_are_final', value: { boolean_value: false, type: 'BOOLEAN' } }],
        },
    };
    const post = tweet('1', {
        media: [{ ...photo, sensitive_media_warning: { adult_content: true }, ext_sensitive_media_warning: {} }],
        card: poll,
        extra: { birdwatch_pivot: { title: 'note' } },
    });
    post.legacy.possibly_sensitive = true;
    const settings = settingsWith({ hideCommunityNotes: true, showSensitiveMedia: true, forceTranslate: true, showPollResults: true });

    const out = run(HOME, timeline([item('tweet-1', post)]), settings);
    const result = out.data.home.home_timeline_urt.instructions[0].entries[0].content.itemContent.tweet_results.result;

    assert.equal(result.birdwatch_pivot, undefined);
    assert.equal(result.legacy.possibly_sensitive, false);
    assert.equal(result.legacy.extended_entities.media[0].sensitive_media_warning, undefined);
    assert.equal(result.legacy.extended_entities.media[0].ext_sensitive_media_warning, undefined);
    assert.equal(result.is_translatable, true);
    assert.equal(result.card.legacy.binding_values.find((b) => b.key === 'counts_are_final').value.boolean_value, true);
});

test('No shortened URL expands entity and card links', () => {
    const post = tweet('1', {
        card: { legacy: { name: 'summary', url: 'https://t.co/abc', binding_values: [{ key: 'card_url', value: { string_value: 'https://t.co/abc', type: 'STRING' } }] } },
    });
    post.legacy.entities.urls = [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/page', display_url: 'example.com/page' }];
    const links = [];
    const store = { add() {}, link: (short, expanded) => links.push([short, expanded]) };

    const out = run(HOME, timeline([item('tweet-1', post)]), settingsWith({ noShortenedUrl: true }), store);
    const result = out.data.home.home_timeline_urt.instructions[0].entries[0].content.itemContent.tweet_results.result;
    assert.equal(result.legacy.entities.urls[0].url, 'https://example.com/page');
    assert.equal(result.legacy.full_text, 'hello');
    assert.equal(result.card.legacy.url, 'https://example.com/page');
    assert.equal(result.card.legacy.binding_values[0].value.string_value, 'https://example.com/page');
    assert.deepEqual(links, [['https://t.co/abc', 'https://example.com/page']]);
});

test('summaries pick the original photo and the best mp4', () => {
    const video = {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg',
        video_info: {
            variants: [
                { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a.m3u8' },
                { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/low.mp4' },
                { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' },
            ],
        },
    };
    const summary = R.summarize(tweet('1', { media: [photo, video] }));
    assert.equal(summary.screenName, 'someone');
    assert.deepEqual(summary.media.map((m) => m.url), ['https://pbs.twimg.com/media/ABC?format=jpg&name=orig', 'https://video.twimg.com/high.mp4']);
});

test('summaries read like the post: unescaped, links expanded, no mentions or media link', () => {
    const post = tweet('1', { text: '@bob Tom &amp; Jerry 🐱 https://t.co/a https://t.co/m' });
    // Code points of the unescaped text: the emoji is one.
    post.legacy.entities.urls = [{ url: 'https://t.co/a', expanded_url: 'https://example.com', indices: [19, 33] }];
    post.legacy.entities.media = [{ url: 'https://t.co/m', indices: [34, 48] }];
    post.legacy.display_text_range = [5, 33];
    assert.equal(R.summarize(post).text, 'Tom & Jerry 🐱 https://example.com');

    const long = tweet('2', { text: 'cut…' });
    long.note_tweet = { note_tweet_results: { result: { text: 'the whole long post' } } };
    assert.equal(R.summarize(long).text, 'the whole long post');
});

test('conversations: reply threads, their Show more, further pages; not the post itself', () => {
    const thread = (id, posts, cursor) => ({
        entryId: `conversationthread-${id}`,
        content: {
            entryType: 'TimelineTimelineModule',
            items: [
                ...posts.map((post) => ({ entryId: `x-${post.rest_id}`, item: { itemContent: { __typename: 'TimelineTweet', tweet_results: { result: post } } } })),
                ...(cursor ? [{ entryId: 'c', item: { itemContent: { __typename: 'TimelineTimelineCursor', cursorType: 'ShowMore', value: cursor } } }] : []),
            ],
        },
    });
    const json = {
        data: {
            threaded_conversation_with_injections_v2: {
                instructions: [
                    { type: 'TimelineClearCache' },
                    {
                        type: 'TimelineAddEntries',
                        entries: [
                            item('tweet-1', tweet('1')),
                            thread('a', [tweet('2'), tweet('3')], 'more-a'),
                            thread('b', [{ __typename: 'TweetWithVisibilityResults', tweet: { ...tweet('4'), __typename: undefined } }]),
                            { entryId: 'tweetdetailrelatedtweets-1', content: { entryType: 'TimelineTimelineModule', items: [] } },
                            { entryId: 'cursor-showmorethreads-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'ShowMoreThreads', value: 'hidden' } },
                            { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'page-2' } },
                            { entryId: 'cursor-top-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Top', value: 'top' } },
                        ],
                    },
                ],
            },
        },
    };
    const parsed = R.parseConversation(json, '1');
    assert.deepEqual(parsed.threads.map((t) => [t.id, t.posts.map((p) => p.rest_id), t.cursor]),
        [['conversationthread-a', ['2', '3'], 'more-a'], ['conversationthread-b', ['4'], null]]);
    assert.deepEqual(parsed.next, [{ cursor: 'page-2', type: 'Bottom' }, { cursor: 'hidden', type: 'ShowMoreThreads' }]);

    const more = R.parseConversation({
        data: { threaded_conversation_with_injections_v2: { instructions: [{
            type: 'TimelineAddToModule',
            moduleEntryId: 'conversationthread-a',
            moduleItems: [{ entryId: 'x', item: { itemContent: { tweet_results: { result: tweet('5') } } } }],
        }] } },
    }, '1');
    assert.deepEqual(more.additions.map((a) => [a.id, a.posts.map((p) => p.rest_id), a.cursor]), [['conversationthread-a', ['5'], null]]);
    assert.deepEqual(R.parseConversation({}, '1'), { threads: [], additions: [], next: [] });
});

test('summaries carry the author and whether you follow them', () => {
    assert.deepEqual(R.summarize(tweet('1')).author, { id: '1', following: false, followRequestSent: false, blocking: false, blockedBy: false });
    assert.equal(R.summarize(tweet('2', { following: true })).author.following, true);

    const requested = tweet('3');
    requested.core.user_results.result.follow_request_sent = true;
    assert.equal(R.summarize(requested).author.followRequestSent, true);
});

test('the store sees every post, quoted ones included', () => {
    const post = tweet('1', { extra: { quoted_status_result: { result: tweet('2') } } });
    const seen = [];
    run(HOME, timeline([item('tweet-1', post)]), settingsWith(), { add: (p) => seen.push(p.rest_id), link() {} });
    assert.deepEqual(seen.sort(), ['1', '2']);
});

// endregion

// region Single responses

test('Customize search suggestions empties accounts or suggestions', () => {
    const url = 'https://x.com/i/api/1.1/search/typeahead.json?q=nasa';
    const json = { users: [{ id: 1 }], topics: [{ topic: 'nasa' }], num_results: 2 };
    const out = run(url, json, settingsWith({ searchSuggestions: { hideUsers: true } }));
    assert.deepEqual(out.users, []);
    assert.equal(out.topics.length, 1);
});

test('Customize explore tabs drops tabs and keeps one', () => {
    const url = 'https://x.com/i/api/graphql/abc/ExplorePage';
    const json = () => ({ data: { explore_page: { body: { timelines: [{ id: 'for_you' }, { id: 'trending' }, { id: 'news' }] } } } });
    const out = run(url, json(), settingsWith({ exploreTabs: { hidden: ['trending', 'NEWS'] } }));
    assert.deepEqual(out.data.explore_page.body.timelines.map((t) => t.id), ['for_you']);
    const all = run(url, json(), settingsWith({ exploreTabs: { hidden: ['for_you', 'trending', 'news'] } }));
    assert.equal(all.data.explore_page.body.timelines.length, 3);
});

test('Customize timeline top bar drops pinned timelines by kind', () => {
    const url = 'https://x.com/i/api/graphql/abc/PinnedTimelines';
    const json = { data: { pinned_timelines: { pinned_timelines: [{ __typename: 'ListPinnedTimeline' }, { __typename: 'CommunityPinnedTimeline' }] } } };
    const out = run(url, json, settingsWith({ homeTabs: { hidePinnedCommunities: true } }));
    assert.deepEqual(out.data.pinned_timelines.pinned_timelines.map((t) => t.__typename), ['ListPinnedTimeline']);
});

test('Hide badges zeroes unread counts', () => {
    const url = 'https://x.com/i/api/graphql/abc/ViewerBadgeCounts';
    const out = run(url, { data: { viewer: { badge_count: { ntab_unread_count: 4, dm_unread_count: 2 } } } }, settingsWith({ hideNavBadges: true }));
    assert.deepEqual(out.data.viewer.badge_count, { ntab_unread_count: 0, dm_unread_count: 0 });
});

// endregion

// region Requests

test('Customize default reply sorting sets the first request only', () => {
    const url = (vars) => 'https://x.com/i/api/graphql/abc/TweetDetail?variables=' + encodeURIComponent(JSON.stringify(vars));
    const settings = settingsWith({ replySort: { sort: 'Recency' } });
    const ctx = { sorted: new Set() };

    const first = new URL(R.rewriteRequestUrl(url({ focalTweetId: '9', rankingMode: 'Relevance' }), settings, ctx));
    assert.equal(JSON.parse(first.searchParams.get('variables')).rankingMode, 'Recency');

    const picked = url({ focalTweetId: '9', rankingMode: 'Likes' });
    assert.equal(R.rewriteRequestUrl(picked, settings, ctx), picked);

    const more = url({ focalTweetId: '8', rankingMode: 'Relevance', cursor: 'c' });
    assert.equal(R.rewriteRequestUrl(more, settings, ctx), more);
});

test('Hook feature flag overrides request features it names', () => {
    const url = 'https://x.com/i/api/graphql/abc/HomeTimeline?features=' + encodeURIComponent(JSON.stringify({ a_enabled: false, b: 1 }));
    const out = new URL(R.rewriteRequestUrl(url, settingsWith({ hookFeatureFlag: { flags: ['a_enabled=true', 'missing=1'] } })));
    assert.deepEqual(JSON.parse(out.searchParams.get('features')), { a_enabled: true, b: 1 });
    assert.deepEqual(R.parseFlags(['x=true', 'y=12', 'z=text', 'bad']), [['x', true], ['y', 12], ['z', 'text']]);
});

// endregion

// region Boot state

test('boot state: upsells off, premium checks on, custom flags set', () => {
    const config = () => ({
        subscriptions_upsells_get_verified_profile: { value: true },
        subscriptions_upsells_analytics_fix_enabled: { value: true },
        premium_paywall_on_app_load_enabled: { value: true },
        subscriptions_feature_1002: { value: false },
        some_flag: { value: false },
    });
    const state = {
        featureSwitch: { defaultConfig: config(), user: { config: config() } },
        settings: { remote: { settings: { display_sensitive_media: false } } },
    };
    R.patchInitialState(state, settingsWith({
        removePremiumUpsell: true, unlockPremium: true, showSensitiveMedia: true, hookFeatureFlag: { flags: ['some_flag=true'] },
    }));

    for (const cfg of [state.featureSwitch.defaultConfig, state.featureSwitch.user.config]) {
        assert.equal(cfg.subscriptions_upsells_get_verified_profile.value, false);
        assert.equal(cfg.subscriptions_upsells_analytics_fix_enabled.value, true);
        assert.equal(cfg.premium_paywall_on_app_load_enabled.value, false);
        assert.equal(cfg.premium_business_offers_navbar_premium_signup_hidden.value, true);
        assert.equal(cfg.subscriptions_feature_1002.value, true);
        assert.equal(cfg.some_flag.value, true);
    }
    assert.equal(state.settings.remote.settings.display_sensitive_media, true);
});

// endregion

// region HLS and links

test('Force HD keeps only the best stream of a master playlist', () => {
    const master = [
        '#EXTM3U',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-32000",URI="/a/32000.m3u8"',
        '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=100000,BANDWIDTH=200000,RESOLUTION=320x320,CODECS="avc1",AUDIO="audio-32000"',
        '/v/320.m3u8',
        '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=900000,BANDWIDTH=1800000,RESOLUTION=1280x1280,CODECS="avc1",AUDIO="audio-32000"',
        '/v/1280.m3u8',
        '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=400000,BANDWIDTH=800000,RESOLUTION=720x720,CODECS="avc1",AUDIO="audio-32000"',
        '/v/720.m3u8',
        '',
    ].join('\n');
    const out = R.transformResponse('https://video.twimg.com/amplify_video/1/pl/m.m3u8', master, settingsWith({ forceHdVideos: true }));
    assert.ok(out.includes('/v/1280.m3u8'));
    assert.ok(!out.includes('/v/320.m3u8'));
    assert.ok(!out.includes('/v/720.m3u8'));
    assert.ok(out.includes('#EXT-X-MEDIA'));
    assert.equal((out.match(/#EXT-X-STREAM-INF/g) || []).length, 1);

    const media = '#EXTM3U\n#EXTINF:3.0,\n/seg1.mp4\n';
    assert.equal(R.keepBestVariant(media), media);
});

test('shared links: legacy form and custom domain', () => {
    const settings = settingsWith({ legacyShareLinks: true, customSharingDomain: { domain: 'fxtwitter.com' } });
    const names = { 42: 'nasa' };
    assert.equal(R.transformShareText('https://x.com/i/status/42', settings, (id) => names[id]), 'https://fxtwitter.com/nasa/status/42');
    assert.equal(R.transformShareText('see https://twitter.com/a/status/1?s=20', settings, () => null), 'see https://fxtwitter.com/a/status/1?s=20');
    assert.equal(R.transformShareText('https://example.com/x.com/', settings, () => null), 'https://example.com/x.com/');
    assert.equal(R.transformShareText('https://x.com/a', settingsWith(), () => null), 'https://x.com/a');
});

// endregion

test('responses that are not JSON pass through untouched', () => {
    assert.equal(R.transformResponse(HOME, '', settingsWith({ removeAds: true })), '');
    assert.equal(R.transformResponse(HOME, 'not json', settingsWith({ removeAds: true })), 'not json');
});

test('only changes to what x.com downloads need the page refreshed', () => {
    const before = catalogue.defaults();
    const change = (edit) => {
        const after = catalogue.merge(JSON.parse(JSON.stringify(before)));
        edit(after);
        return catalogue.needsReload(before, after);
    };

    assert.equal(change(() => {}), false);
    assert.equal(change((s) => { s.options.feedFilters.hideFollowed = true; }), true);
    assert.equal(change((s) => { s.options.filterByKeyword.keywords = ['x']; }), true);
    assert.equal(change((s) => { s.patches.removeAds = false; }), true);
    assert.equal(change((s) => { s.patches.unlockPremium = false; }), true);
    // Hiding parts of the page applies at once.
    assert.equal(change((s) => { s.options.inlineActionBar.hideViews = true; }), false);
    assert.equal(change((s) => { s.patches.followButton = false; }), false);
});

test('settings merge drops unknown and invalid values', () => {
    const merged = catalogue.merge({
        patches: { removeAds: false, bogus: true },
        options: { undoPosts: { seconds: 999 }, replySort: { sort: 'Likes' }, filterByKeyword: { keywords: ['a', 2] } },
    });
    assert.equal(merged.patches.removeAds, false);
    assert.equal('bogus' in merged.patches, false);
    assert.equal(merged.options.undoPosts.seconds, 10);
    assert.equal(merged.options.replySort.sort, 'Likes');
    assert.deepEqual(merged.options.filterByKeyword.keywords, []);
    assert.equal(catalogue.PATCHES.length, 45);
});

test('posts that came with feedback keys are marked; those without are not', () => {
    const withKeys = item('tweet-1', tweet('1'));
    withKeys.content.feedbackInfo = { feedbackKeys: ['123'] };
    const module = {
        entryId: 'home-conversation-1',
        content: {
            entryType: 'TimelineTimelineModule',
            items: [{ entryId: 'x', item: { itemContent: { tweet_results: { result: tweet('2') } }, feedbackInfo: { feedbackKeys: ['456'] } } }],
        },
    };
    const marked = [];
    run(HOME, timeline([withKeys, item('tweet-3', tweet('3')), module]), settingsWith(), { add() {}, link() {}, feedback: (id) => marked.push(id) });
    assert.deepEqual(marked.sort(), ['1', '2']);
});
