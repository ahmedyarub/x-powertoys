/*
 * The patches that hide parts of the page, as one style sheet rebuilt whenever the settings change.
 * Elements are found by their data-testid, link target or ARIA role, which the site keeps stable;
 * the few found only by an English label say so.
 */
(function () {
    'use strict';

    const XPT = globalThis.XPT;

    const NAV = ':is(nav[role="navigation"], [data-testid="BottomBar"])';
    const NAV_OR_MENU = ':is(nav[role="navigation"], [data-testid="BottomBar"], [role="menu"])';
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
        hideNavBadges: [`${NAV} a div[aria-label]`, `${NAV} a [aria-live="polite"]`],
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
