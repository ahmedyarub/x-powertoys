/*
 * The patches that hide parts of the page, as one style sheet rebuilt whenever the settings change.
 * Elements are found by their data-testid, link target or ARIA role, which the site keeps stable;
 * the few found only by an English label say so.
 */
(function () {
    'use strict';

    const XPT = globalThis.XPT;

    // The side navigation and the bottom bar. Not any nav: photo carousels in posts are navs too.
    const NAV = ':is(header[role="banner"] nav[role="navigation"], [data-testid="BottomBar"])';
    const NAV_OR_MENU = ':is(header[role="banner"] nav[role="navigation"], [data-testid="BottomBar"], [role="menu"])';
    const ACTION_BAR = 'article [role="group"]';
    const tab = (link) => `[role="tablist"] [role="presentation"]:has(> ${link})`;

    /** Each option that hides something, with the selectors it hides. */
    const RULES = {
        inlineActionBar: {
            hideReply: [`${ACTION_BAR} > div:has([data-testid="reply"])`],
            hideRetweet: [`${ACTION_BAR} > div:has(:is([data-testid="retweet"], [data-testid="unretweet"]))`],
            hideLike: [`${ACTION_BAR} > div:has(:is([data-testid="like"], [data-testid="unlike"]))`],
            hideViews: [`${ACTION_BAR} > div:has(a[href$="/analytics"])`],
            hideBookmark: [`${ACTION_BAR} > div:has(:is([data-testid="bookmark"], [data-testid="removeBookmark"]))`],
            hideShare: [`${ACTION_BAR} > div:has(button[aria-haspopup="menu"]:not([data-testid]))`],
        },
        navBar: {
            hideExplore: [`${NAV} a[data-testid="AppTabBar_Explore_Link"]`],
            hideGrok: [`${NAV} a[href="/i/grok"]`, '[data-testid="GrokDrawer"]'],
            hideNotifications: [`${NAV} a[data-testid="AppTabBar_Notifications_Link"]`],
            hideDm: [`${NAV} a[data-testid="AppTabBar_DirectMessage_Link"]`, '[data-testid="chat-drawer-root"]'],
            hideCalls: [`${NAV} a[data-testid="AppTabBar_Calls_Link"]`],
        },
        notificationTabs: {
            hideAll: [tab('a[href="/notifications"]')],
            hideMentions: [tab('a[href="/notifications/mentions"]')],
            hideVerified: [tab('a[href="/notifications/verified"]')],
            hidePriority: [tab('a[href="/notifications/priority"]')],
        },
        searchTabs: {
            hideTop: [tab('a[href^="/search?"]:not([href*="&f="])'), tab('a[href^="/search?"][href*="&f=top"]')],
            hideLatest: [tab('a[href^="/search?"][href*="&f=live"]')],
            hidePeople: [tab('a[href^="/search?"][href*="&f=user"]')],
            hideMedia: [tab('a[href^="/search?"][href*="&f=media"]')],
            hideLists: [tab('a[href^="/search?"][href*="&f=list"]')],
        },
        sideBar: {
            hidePremium: [`${NAV_OR_MENU} :is([data-testid="premium-signup-tab"], a[href^="/i/premium_sign_up"], a[href^="/i/premium"])`],
            hideCommunities: [`${NAV_OR_MENU} a[href$="/communities"]`],
            hideBookmarks: [`${NAV_OR_MENU} :is(a[href="/i/bookmarks"], a[href="/i/history"])`],
            hideCommunityNotes: [`${NAV_OR_MENU} :is(a[href="/i/communitynotes"], a[href="/i/birdwatch"])`],
            hideLists: [`${NAV_OR_MENU} a[href$="/lists"]`],
            hideSpaces: [`${NAV_OR_MENU} a[href^="/i/spaces/start"]`],
            hideFollowRequests: [`${NAV_OR_MENU} a[href="/follower_requests"]`],
            hideMonetization: [`${NAV_OR_MENU} :is(a[href="/settings/monetization"], a[href^="/i/monetization"])`],
            hideCreatorStudio: [`${NAV_OR_MENU} :is(a[href^="/i/jf/creators/studio"], a[href^="/i/creator-studio"])`],
            hideAnalytics: [`${NAV_OR_MENU} a[href="/i/account_analytics"]`],
            hideBusiness: [`${NAV_OR_MENU} a[href="/i/verified-orgs-signup"]`],
            hideAds: [`${NAV_OR_MENU} a[href^="https://ads.x.com"]`],
            hideGrok: [`${NAV_OR_MENU} a[href="/i/grok"]`],
        },
        rightSidebar: {
            // The bordered card around each section; the column holds them side by side.
            hideWhoToFollow: ['[data-testid="sidebarColumn"] div:has(> div > aside a[href^="/i/connect_people"])'],
            hideWhatsHappening: ['[data-testid="sidebarColumn"] div:has(> section [data-testid="trend"])'],
            hideTodaysNews: ['[data-testid="sidebarColumn"] div:has(> [data-testid="news_sidebar"])'],
        },
        homeTabs: {
            // For you and Following are the first two tabs; pinned timelines follow them.
            hideForYou: [`html[data-xpt-page="home"] [data-testid="primaryColumn"] [role="tablist"] [role="presentation"]:has(> [role="tab"]):nth-child(1)`],
            hideFollowing: [`html[data-xpt-page="home"] [data-testid="primaryColumn"] [role="tablist"] [role="presentation"]:has(> [role="tab"]):nth-child(2)`],
            // English label: the button has no other name.
            hideAddTab: ['html[data-xpt-page="home"] [data-testid="primaryColumn"] button[aria-label="Manage timelines"]'],
        },
    };

    /** Patches that hide something whenever they are on. */
    const PATCH_RULES = {
        hidePromoteButton: ['article a[href*="/quick_promote"]', 'article a[href*="/i/boost"]'],
        removePremiumUpsell: [
            `${NAV_OR_MENU} :is([data-testid="premium-signup-tab"], a[href^="/i/premium_sign_up"])`,
            'a[href^="/i/verified-choose"]',
            '[data-testid="verified_profile_upsell"]',
            '[data-testid="super-upsell-UpsellCardRenderProperties"]',
            '[data-testid="sidebarColumn"] aside:has(a[href^="/i/premium_sign_up"])',
            '[data-testid="sidebarColumn"] div:has(> aside a[href^="/i/premium_sign_up"])',
        ],
        hideBanner: ['[data-testid="primaryColumn"] [role="button"]:has([data-testid="pillLabel"])'],
        hideCommunityNotes: ['[data-testid="birdwatch-pivot"]'],
        hideFab: ['[data-testid="FloatingActionButtons_Tweet_Button"]', '[data-testid^="FloatingActionButtons"]'],
        hideNavBadges: [`${NAV} a[data-testid^="AppTabBar_"] div[aria-label]`, `${NAV} a[data-testid^="AppTabBar_"] [aria-live="polite"]`],
    };

    function exploreRules() {
        if (!XPT.on('exploreTabs')) return [];
        return (XPT.opt('exploreTabs', 'hidden') || [])
            .map((id) => String(id).trim().toLowerCase())
            .filter((id) => /^[a-z0-9_-]+$/.test(id))
            .map((id) => tab(`a[href="/explore/tabs/${id}"]`));
    }

    function build() {
        const hidden = [];
        for (const [patch, options] of Object.entries(RULES)) {
            if (!XPT.on(patch)) continue;
            for (const [key, selectors] of Object.entries(options)) {
                if (XPT.opt(patch, key) === true) hidden.push(...selectors);
            }
        }
        for (const [patch, selectors] of Object.entries(PATCH_RULES)) {
            if (XPT.on(patch)) hidden.push(...selectors);
        }
        hidden.push(...exploreRules());

        // Each selector stands alone: one the browser rejects does not take the others with it.
        const css = hidden.map((selector) => `${selector} { display: none !important; }`);
        css.push(`
            [data-xpt-item]:hover { background-color: rgba(127, 127, 127, 0.1); }
            .xpt-action { display: flex; align-items: center; justify-content: flex-start; }
            .xpt-action button { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px;
                margin-left: -8px; border: 0; border-radius: 999px; background: transparent; color: rgb(113, 118, 123); cursor: pointer; }
            .xpt-action button:hover { background: rgba(29, 155, 240, 0.1); color: rgb(29, 155, 240); }
            .xpt-action svg { width: 18.75px; height: 18.75px; fill: currentColor; }
            .xpt-actions { flex: none; display: inline-flex; align-items: center; gap: 6px; margin: 0 6px 0 4px; }
            .xpt-follow, .xpt-chip { flex: none; padding: 0 12px; height: 24px; border-radius: 999px; cursor: pointer;
                font: 700 13px/22px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; white-space: nowrap; }
            .xpt-follow { border: 1px solid transparent; }
            .xpt-actions-dark .xpt-follow { background: #eff3f4; color: #0f1419; }
            .xpt-actions-light .xpt-follow { background: #0f1419; color: #ffffff; }
            .xpt-chip { background: transparent; border: 1px solid rgb(83, 100, 113); }
            .xpt-actions-dark .xpt-chip { color: #e7e9ea; }
            .xpt-actions-light .xpt-chip { color: #0f1419; border-color: rgb(207, 217, 222); }
            .xpt-chip-danger { color: rgb(244, 33, 46) !important; border-color: rgba(244, 33, 46, 0.5) !important; }
            .xpt-follow:hover, .xpt-chip:hover { opacity: 0.85; }
            .xpt-follow:disabled, .xpt-chip:disabled { opacity: 0.5; cursor: progress; }
            .xpt-replies { --xpt-text: #0f1419; --xpt-muted: #536471; --xpt-line: #eff3f4; --xpt-hover: rgba(0, 0, 0, 0.03);
                padding: 0 16px 10px 68px; color: var(--xpt-text); border-bottom: 1px solid var(--xpt-line);
                font: 15px/20px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; cursor: default; }
            .xpt-replies.xpt-theme-dim { --xpt-text: #f7f9f9; --xpt-muted: #8b98a5; --xpt-line: #38444d; --xpt-hover: rgba(255, 255, 255, 0.03); }
            .xpt-replies.xpt-theme-dark { --xpt-text: #e7e9ea; --xpt-muted: #71767b; --xpt-line: #2f3336; --xpt-hover: rgba(255, 255, 255, 0.03); }
            .xpt-replies [hidden] { display: none !important; }
            .xpt-replies-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
            .xpt-replies-button { padding: 4px 0; border: 0; background: none; color: rgb(29, 155, 240); font: inherit;
                font-size: 14px; cursor: pointer; }
            .xpt-replies-button:hover { text-decoration: underline; }
            .xpt-replies-status { font-size: 13px; }
            .xpt-replies-status.xpt-error { color: rgb(244, 33, 46); }
            .xpt-muted { color: var(--xpt-muted); text-decoration: none; }
            .xpt-thread { position: relative; padding: 2px 0; border-top: 1px solid var(--xpt-line); }
            /* Each level of replies sits under its parent's avatar, a thread line down its left. */
            .xpt-branch { margin-left: 19px; padding-left: 12px; border-left: 2px solid var(--xpt-line); }
            .xpt-branch-flat { margin-left: 0; padding-left: 0; border-left: 0; }
            .xpt-node-more { display: block; margin: 0 0 4px 4px; }
            .xpt-reply { position: relative; display: flex; gap: 10px; padding: 8px 4px; border-radius: 8px; cursor: pointer; }
            .xpt-reply:hover { background: var(--xpt-hover); }
            .xpt-reply-avatar { flex: none; width: 32px; height: 32px; border-radius: 50%; overflow: hidden; background: var(--xpt-line); }
            .xpt-reply-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .xpt-reply-body { min-width: 0; flex: 1; }
            .xpt-reply-head { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
            .xpt-reply-name { color: var(--xpt-text); font-weight: 700; text-decoration: none; }
            .xpt-reply-name:hover, .xpt-reply-time:hover { text-decoration: underline; }
            .xpt-reply-text { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
            .xpt-link { color: rgb(29, 155, 240); text-decoration: none; }
            .xpt-link:hover { text-decoration: underline; }
            .xpt-reply-media { display: grid; gap: 2px; margin-top: 8px; max-width: 420px; border-radius: 12px; overflow: hidden;
                border: 1px solid var(--xpt-line); }
            .xpt-media-2, .xpt-media-3, .xpt-media-4 { grid-template-columns: 1fr 1fr; }
            .xpt-reply-tile { position: relative; display: block; aspect-ratio: 16 / 9; background: var(--xpt-line); }
            .xpt-media-1 .xpt-reply-tile { aspect-ratio: auto; max-height: 360px; }
            .xpt-reply-tile img { width: 100%; height: 100%; max-height: 360px; object-fit: cover; display: block; }
            .xpt-reply-play { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 40px; height: 40px;
                border-radius: 50%; background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 16px; line-height: 40px; text-align: center; }
            .xpt-reply-stats { display: flex; gap: 28px; margin-top: 6px; font-size: 13px; }
            .xpt-reply-stat { display: inline-flex; align-items: center; gap: 4px; min-width: 40px; }
            .xpt-reply-stat svg { width: 15px; height: 15px; fill: currentColor; }
            .xpt-replies-empty { padding: 8px 0; font-size: 14px; }
            /* While the Follow button drives the post menu, the menu stays out of sight. */
            html.xpt-quiet #layers [role="menu"] { opacity: 0 !important; }
        `);
        return css.join('\n');
    }

    let style;
    function render() {
        if (!style) {
            style = document.createElement('style');
            style.id = 'xpt-style';
        }
        style.textContent = build();
        if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    }

    render();
    XPT.onChange(render);
    // document_start runs before <head> exists; move the sheet there once it does.
    document.addEventListener('DOMContentLoaded', render, { once: true });
})();
