/*
 * The patch catalogue: one entry per X patch in morphe-patches-ahmedyarub, with the same names,
 * descriptions, options and defaults. Every patch is on by default, as it is when patching.
 *
 * Loaded in every context: the page hook, the content script, the background, the options page
 * and the popup. Settings are { patches: { id: boolean }, options: { id: { key: value } } }.
 */
(function (root) {
    'use strict';

    const bool = (key, title, def = false, description = '') => ({ key, type: 'bool', title, default: def, description });
    const text = (key, title, def, description = '') => ({ key, type: 'text', title, default: def, description });
    const list = (key, title, def, description = '') => ({ key, type: 'list', title, default: def, description });
    const int = (key, title, def, min, max, description = '') => ({ key, type: 'int', title, default: def, min, max, description });
    const choice = (key, title, def, choices, description = '') => ({ key, type: 'choice', title, default: def, choices, description });

    const GROUPS = [
        { id: 'ads', title: 'Ads' },
        { id: 'timeline', title: 'Timeline' },
        { id: 'customize', title: 'Customize' },
        { id: 'hide', title: 'Hide' },
        { id: 'postMenu', title: 'Post menu' },
        { id: 'download', title: 'Download' },
        { id: 'links', title: 'Links' },
        { id: 'premium', title: 'Premium' },
        { id: 'misc', title: 'Misc' },
    ];

    const PATCHES = [
        // region Ads
        {
            id: 'removeAds', group: 'ads', name: 'Remove Ads',
            description: 'Removes promoted posts, accounts and trends from timelines.',
        },
        // endregion

        // region Timeline
        {
            id: 'filterByKeyword', group: 'timeline', name: 'Filter posts by keyword',
            description: 'Hides posts whose text contains any of your keywords, ignoring case.',
            options: [list('keywords', 'Filtered keywords', [], 'One word or phrase per line.')],
        },
        {
            id: 'feedFilters', group: 'timeline', name: 'Feed filters',
            description: 'Adds feed filters to timelines: media only (images, videos, GIFs), hide followed profiles, ' +
                'hide suggested accounts and communities, and include keywords.',
            options: [
                bool('mediaOnly', 'Media only', false, 'Only posts with photos, videos or GIFs.'),
                bool('hideFollowed', 'Hide followed profiles', false, 'Leaves out posts by accounts you follow.'),
                bool('hideSuggested', 'Hide suggestions', true, 'Leaves out Who to follow and similar suggestion modules.'),
                list('includeKeywords', 'Include keywords', [], 'When set, only posts containing at least one of these are shown.'),
            ],
        },
        {
            id: 'showSensitiveMedia', group: 'timeline', name: 'Show sensitive media',
            description: 'Shows media marked sensitive without blurring it behind a warning.',
        },
        {
            id: 'showPollResults', group: 'timeline', name: 'Show poll results',
            description: 'Shows the results of polls without voting. Polls cannot be voted on while this is on.',
        },
        {
            id: 'forceHdVideos', group: 'timeline', name: 'Enable force HD videos',
            description: 'Always plays videos at the highest quality available, whatever the connection.',
        },
        {
            id: 'forceTranslate', group: 'timeline', name: 'Force enable translate',
            description: 'Offers to translate every post, not only those the server marks translatable.',
        },
        {
            id: 'followButton', group: 'timeline', name: 'Follow button on posts',
            description: 'Shows a Follow button next to the author\'s name on posts by accounts you do not follow. ' +
                'It follows through the post\'s own menu and goes once X confirms the follow.',
        },
        {
            id: 'inlineReplies', group: 'timeline', name: 'Inline replies',
            description: 'Adds Show replies under posts, which opens the replies right below the post instead of on ' +
                'its own page, with Load more and Expand all.',
            options: [int('maxReplies', 'Expand all limit', 100, 10, 2000, 'Expand all stops once this many replies are loaded.')],
        },
        {
            id: 'disableAutoScroll', group: 'timeline', name: 'Disable auto timeline scroll on launch',
            description: 'Opens the home timelines where you left them, instead of at the newest posts. ' +
                'For you is regenerated on every visit, so only the other tabs are restored.',
        },
        // endregion

        // region Customize
        {
            id: 'inlineActionBar', group: 'customize', name: 'Customize Inline action Bar items',
            description: 'Hides actions from the bar under each post.',
            options: [
                bool('hideReply', 'Hide reply'),
                bool('hideRetweet', 'Hide repost'),
                bool('hideLike', 'Hide like'),
                bool('hideViews', 'Hide views'),
                bool('hideBookmark', 'Hide bookmark'),
                bool('hideShare', 'Hide share'),
            ],
        },
        {
            id: 'navBar', group: 'customize', name: 'Customize Navigation Bar items',
            description: 'Hides tabs from the navigation bar. Home always stays.',
            options: [
                bool('hideExplore', 'Hide Explore'),
                bool('hideGrok', 'Hide Grok', true, 'Also hides the floating Grok button.'),
                bool('hideNotifications', 'Hide Notifications'),
                bool('hideDm', 'Hide Chat', false, 'Also hides the floating chat button.'),
                bool('hideCalls', 'Hide Calls'),
            ],
        },
        {
            id: 'replySort', group: 'customize', name: 'Customize default reply sorting',
            description: 'Sets the sort replies open with. The sort menu keeps showing the site default.',
            options: [choice('sort', 'Default sort', 'Relevance', { Relevance: 'Relevance', Recency: 'Recent', Likes: 'Likes' })],
        },
        {
            id: 'exploreTabs', group: 'customize', name: 'Customize explore tabs',
            description: 'Hides tabs from the Explore page.',
            options: [list('hidden', 'Hidden tabs', [], 'Tab ids, one per line: for_you, trending, news, sports, entertainment.')],
        },
        {
            id: 'notificationTabs', group: 'customize', name: 'Customize notification tabs',
            description: 'Hides tabs from Notifications.',
            options: [
                bool('hideAll', 'Hide All'),
                bool('hideMentions', 'Hide Mentions'),
                bool('hideVerified', 'Hide Verified'),
                bool('hidePriority', 'Hide Priority'),
            ],
        },
        {
            id: 'searchSuggestions', group: 'customize', name: 'Customize search suggestions',
            description: 'Hides kinds of suggestion from the search box.',
            options: [bool('hideUsers', 'Hide accounts'), bool('hideSuggestions', 'Hide search suggestions')],
        },
        {
            id: 'searchTabs', group: 'customize', name: 'Customize search tab items',
            description: 'Hides tabs from search results.',
            options: [
                bool('hideTop', 'Hide Top'),
                bool('hideLatest', 'Hide Latest'),
                bool('hidePeople', 'Hide People'),
                bool('hideMedia', 'Hide Media'),
                bool('hideLists', 'Hide Lists'),
            ],
        },
        {
            id: 'sideBar', group: 'customize', name: 'Customize side bar items',
            description: 'Hides rows from the side navigation and its More menu.',
            options: [
                bool('hidePremium', 'Hide Premium'),
                bool('hideCommunities', 'Hide Communities'),
                bool('hideBookmarks', 'Hide Bookmarks / History'),
                bool('hideCommunityNotes', 'Hide Community Notes'),
                bool('hideLists', 'Hide Lists'),
                bool('hideSpaces', 'Hide Spaces'),
                bool('hideFollowRequests', 'Hide Follow requests'),
                bool('hideMonetization', 'Hide Monetization'),
                bool('hideCreatorStudio', 'Hide Creator Studio'),
                bool('hideAnalytics', 'Hide Analytics'),
                bool('hideBusiness', 'Hide Business'),
                bool('hideAds', 'Hide Ads'),
                bool('hideGrok', 'Hide Grok', true),
            ],
        },
        {
            id: 'homeTabs', group: 'customize', name: 'Customize timeline top bar',
            description: 'Hides tabs from the top of the home timeline. At least one tab always stays.',
            options: [
                bool('hideForYou', 'Hide For you'),
                bool('hideFollowing', 'Hide Following'),
                bool('hidePinnedLists', 'Hide pinned lists'),
                bool('hidePinnedCommunities', 'Hide pinned communities'),
                bool('hidePinnedTopics', 'Hide pinned topics'),
                bool('hideAddTab', 'Hide the Manage timelines (+) button'),
            ],
        },
        // endregion

        // region Hide
        {
            id: 'hidePromoteButton', group: 'hide', name: 'Hide promote button',
            description: 'Hides the Promote / Boost button on your posts and the item in their menu.',
        },
        {
            id: 'removePremiumUpsell', group: 'hide', name: 'Remove premium upsell',
            description: 'Removes Premium upsells: the Premium navigation row, the Subscribe cards, ' +
                'and the Get verified cards and prompts.',
        },
        {
            id: 'hideBanner', group: 'hide', name: 'Hide Banner',
            description: 'Hides the "See new posts" pill at the top of the timeline.',
        },
        {
            id: 'hideCommunityNotes', group: 'hide', name: 'Hide Community Notes',
            description: 'Hides Community Notes under posts.',
        },
        {
            id: 'hideFab', group: 'hide', name: 'Hide FAB',
            description: 'Hides the floating Post button.',
        },
        {
            id: 'hideNavBadges', group: 'hide', name: 'Hide badges from navigation bar icons',
            description: 'Hides the unread counts and dots on the navigation bar.',
        },
        // endregion

        // region Post menu
        {
            id: 'customShareMenu', group: 'postMenu', name: 'Custom share menu',
            description: 'Hides options from the post menu.',
            options: [list('hiddenOptions', 'Hidden options', [],
                'One per line: NotInterested, Follow, AddToList, Mute, Block, ViewEngagements, Embed, Report, ' +
                'RequestCommunityNote, WhyThisAd, Pin, Highlight.')],
        },
        {
            id: 'shareAsImage', group: 'postMenu', name: 'Share Tweet as Image',
            description: 'Adds "Share as image" to the share menu of a post, which renders it as an image card.',
        },
        {
            id: 'copyMediaLink', group: 'postMenu', name: 'Add ability to copy media link',
            description: 'Adds "Copy media link" to the post menu: the direct links of the post\'s photos, videos and GIFs.',
        },
        {
            id: 'externalDownloader', group: 'postMenu', name: 'Support external downloader',
            description: 'Adds "Open in downloader" to the post menu, which hands the post\'s link to a downloader.',
            options: [text('urlTemplate', 'Downloader URL', '',
                'Opened with {url} replaced by the post link, e.g. https://example.com/?u={url}. ' +
                'Empty: use the system share sheet, or copy the link where there is none.')],
        },
        {
            id: 'readerMode', group: 'postMenu', name: 'Native reader mode',
            description: 'Adds "Reader mode" to the post menu: the post\'s text, selectable, with links to its media.',
        },
        {
            id: 'nativeTranslator', group: 'postMenu', name: 'Native translator',
            description: 'Adds "Translate with Google" to the post menu.',
        },
        {
            id: 'postDebugMenu', group: 'postMenu', name: 'Enable debug menu for posts',
            description: 'Adds "Post data" to the post menu: everything the site sent about the post, as JSON.',
        },
        // endregion

        // region Download
        {
            id: 'nativeDownloader', group: 'download', name: 'Native downloader',
            description: 'Adds a download button to every post with photos, videos or GIFs, and "Download media" ' +
                'to its share menu. Saves the original quality, without a watermark.',
        },
        {
            id: 'customDownloadFolder', group: 'download', name: 'Custom download folder',
            description: 'Saves downloaded photos and videos to a folder of your choice inside the downloads folder.',
            options: [text('folder', 'Folder', 'X', 'Relative to the browser\'s downloads folder.')],
        },
        // endregion

        // region Links
        {
            id: 'customSharingDomain', group: 'links', name: 'Custom sharing domain',
            description: 'Shares and copies links with another domain, such as fxtwitter.com, in place of x.com.',
            options: [text('domain', 'Domain', 'fxtwitter.com', 'The domain shared links point at, without https://.')],
        },
        {
            id: 'handleCustomLinks', group: 'links', name: 'Handle custom twitter links',
            description: 'Opens links to other X frontends, such as fxtwitter and vxtwitter, on x.com.',
            options: [list('hosts', 'Link hosts',
                ['vxtwitter.com', 'fixvx.com', 'fxtwitter.com', 'fixupx.com', 'twittpr.com', 'xcancel.com'],
                'Hosts to open on x.com. Subdomains are included.')],
        },
        {
            id: 'legacyShareLinks', group: 'links', name: 'Legacy share links',
            description: 'Shares posts as x.com/<username>/status/<id> rather than x.com/i/status/<id>.',
        },
        {
            id: 'noShortenedUrl', group: 'links', name: 'No shortened URL',
            description: 'Opens links in posts at their real address instead of through t.co.',
        },
        // endregion

        // region Premium
        {
            id: 'undoPosts', group: 'premium', name: 'Enable Undo Posts',
            description: 'Holds each post for a few seconds before sending it, so it can be undone.',
            options: [int('seconds', 'Undo period (seconds)', 10, 1, 60, 'Seconds a post waits before it is sent.')],
        },
        {
            id: 'unlockPremium', group: 'premium', name: 'Unlock Premium checks',
            description: 'Makes the site\'s own Premium feature checks pass. Features the server enforces still need a subscription.',
        },
        // endregion

        // region Misc
        {
            id: 'hookFeatureFlag', group: 'misc', name: 'Hook feature flag',
            description: 'Overrides the site\'s feature switches with values of your choice.',
            options: [list('flags', 'Feature flags', [],
                'One key=value per line, e.g. some_feature_enabled=true. Values are read as JSON, else as text.')],
        },
        {
            id: 'loginToken', group: 'misc', name: 'Import/Export login token',
            description: 'Adds Export login and Import login to the settings, to move a session between browsers.',
        },
        {
            id: 'deleteFromDatabase', group: 'misc', name: 'Delete from database',
            description: 'Adds an option to the settings to clear the site\'s cached timelines.',
        },
        // endregion
    ];

    /**
     * Patches that work on what x.com downloads (timelines and the boot feature switches). What the
     * page already holds is not rewritten, so changing one of these needs the page loaded anew.
     */
    const NEEDS_RELOAD = new Set([
        'removeAds', 'filterByKeyword', 'feedFilters', 'showSensitiveMedia', 'showPollResults', 'forceHdVideos',
        'forceTranslate', 'exploreTabs', 'homeTabs', 'hideCommunityNotes', 'noShortenedUrl', 'removePremiumUpsell',
        'unlockPremium', 'hookFeatureFlag',
    ]);
    for (const patch of PATCHES) patch.needsReload = NEEDS_RELOAD.has(patch.id);

    const BY_ID = Object.fromEntries(PATCHES.map((patch) => [patch.id, patch]));

    /** If going from one settings object to another changes a patch that needs the page loaded anew. */
    function needsReload(before, after) {
        return PATCHES.some((patch) => patch.needsReload && (
            before?.patches?.[patch.id] !== after?.patches?.[patch.id] ||
            JSON.stringify(before?.options?.[patch.id] ?? {}) !== JSON.stringify(after?.options?.[patch.id] ?? {})));
    }

    function defaults() {
        const settings = { patches: {}, options: {} };
        for (const patch of PATCHES) {
            settings.patches[patch.id] = true;
            settings.options[patch.id] = {};
            for (const option of patch.options || []) {
                settings.options[patch.id][option.key] = clone(option.default);
            }
        }
        return settings;
    }

    /** The defaults with whatever was stored laid over them. Unknown ids and keys are dropped. */
    function merge(stored) {
        const settings = defaults();
        if (!stored || typeof stored !== 'object') return settings;

        for (const patch of PATCHES) {
            if (typeof stored.patches?.[patch.id] === 'boolean') settings.patches[patch.id] = stored.patches[patch.id];

            const options = stored.options?.[patch.id];
            if (!options) continue;
            for (const option of patch.options || []) {
                if (option.key in options && valid(option, options[option.key])) {
                    settings.options[patch.id][option.key] = clone(options[option.key]);
                }
            }
        }
        return settings;
    }

    function valid(option, value) {
        switch (option.type) {
            case 'bool': return typeof value === 'boolean';
            case 'text': return typeof value === 'string';
            case 'list': return Array.isArray(value) && value.every((item) => typeof item === 'string');
            case 'int': return Number.isInteger(value) && value >= option.min && value <= option.max;
            case 'choice': return Object.prototype.hasOwnProperty.call(option.choices, value);
            default: return false;
        }
    }

    function clone(value) {
        return Array.isArray(value) ? value.slice() : value;
    }

    /** If a patch is on. */
    function on(settings, id) {
        return settings?.patches?.[id] === true;
    }

    /** An option of a patch, or its default. */
    function opt(settings, id, key) {
        const value = settings?.options?.[id]?.[key];
        if (value !== undefined) return value;
        return BY_ID[id]?.options?.find((option) => option.key === key)?.default;
    }

    /** An option of a patch only when the patch is on, else undefined. */
    function onOpt(settings, id, key) {
        return on(settings, id) ? opt(settings, id, key) : undefined;
    }

    root.XPT_CATALOGUE = { GROUPS, PATCHES, BY_ID, defaults, merge, on, opt, onOpt, needsReload };
})(typeof module !== 'undefined' && module.exports ? module.exports : globalThis);
