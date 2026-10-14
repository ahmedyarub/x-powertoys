# X Power Toys

A Firefox extension that brings the X patches from
[morphe-patches-ahmedyarub](https://github.com/ahmedyarub/morphe-patches) to x.com. Every Android
patch has a counterpart here with the same name, options and defaults, and every patch can be
turned on and off in the settings.

## Install

Needs Firefox 128 or newer (content scripts in the page's own world).

- **Install:** download the `.xpi` from the [latest release](https://github.com/ahmedyarub/x-powertoys/releases/latest)
  and open it in Firefox (or drag it onto a Firefox window). It is signed by Mozilla, so it installs
  permanently in release Firefox.
- **Try a change:** open `about:debugging#/runtime/this-firefox`, choose *Load Temporary Add-on…* and
  pick `manifest.json`. It stays until Firefox restarts.
- **Run from source:** `npm run start` launches Firefox with the extension loaded.

Settings live behind the toolbar button (feed filters and keywords) and on the add-on's options page
(everything). Changes that work on what x.com downloads (filters, ads, rewrites) refresh the open
x.com pages on Save; the rest apply at once.

## How it works

| Part | Runs in | Does |
| --- | --- | --- |
| `src/page/hook.js` | the page, before x.com's scripts | Wraps `XMLHttpRequest` and `fetch`: rewrites GraphQL requests and responses and HLS playlists, holds new posts for Undo, patches the boot feature switches (`window.__INITIAL_STATE__`), rewrites copied and shared links |
| `src/page/rewrite.js` | the page, and node for tests | The pure JSON / playlist transforms the hook applies |
| `src/content/*.js` | the content script | Settings bridge, hiding CSS, post and share menu actions, download buttons, dialogs, Share as image, home tabs, remembered home position |
| `src/background.js` | the background | Downloads into the chosen folder, image fetches for Share as image, login token, cache clearing, redirect rules for frontend links |

Timelines are filtered as data, before the site renders them, the same way the Android patches drop
items before they reach the timeline database. Parts of the page are hidden by `data-testid`, link
target or ARIA role, never by layout position or class name.

Only the signed-in x.com client is patched. Signed out, x.com serves a different, server-rendered
client that none of this applies to.

## Patches

| Android patch | On x.com |
| --- | --- |
| Remove Ads | Drops promoted posts, accounts, trends and modules from every timeline response, and asks with `includePromotedContent: false` |
| Filter posts by keyword | Drops posts whose text (long posts included) contains a keyword. Edit from the post menu, the popup or the settings |
| Feed filters | Media only, hide followed, hide suggestions (Who to follow and similar modules), include keywords. The post you opened a conversation on always stays |
| Show sensitive media | Clears the sensitive flags and warnings on posts and media, and turns on *display sensitive media* |
| Show poll results | Marks polls final so their results show. Polls cannot be voted on while this is on |
| Enable force HD videos | Rewrites each video's HLS master playlist to offer only its best stream |
| Force enable translate | Marks every post translatable, so *Show translation* is offered on all of them |
| Disable auto timeline scroll on launch | Remembers the top post of each home tab and scrolls back to it on the next visit, loading more as needed. For you is regenerated each visit, so it is skipped |
| Customize Inline action Bar items | Hides reply, repost, like, views, bookmark, share |
| Customize Navigation Bar items | Hides Explore, Grok (default), Notifications, Chat, Calls (default); Grok and Chat take their floating buttons with them |
| Customize default reply sorting | Opens conversations sorted by Relevance, Recent or Likes. The sort menu keeps showing the site default; picking a sort there still works |
| Customize explore tabs | Drops Explore tabs by id (`for_you`, `trending`, `news`, `sports`, `entertainment`) |
| Customize notification tabs | Hides All, Mentions, Verified, Priority |
| Customize search suggestions | Empties the accounts or the query suggestions of the search box |
| Customize search tab items | Hides Top, Latest, People, Media, Lists |
| Customize side bar items | Hides rows of the side navigation and its More menu: Premium, Communities, Bookmarks / History, Community Notes, Lists, Spaces, Follow requests, Monetization, Creator Studio (default), Analytics, Business, Ads, Grok (default) |
| Customize right side bar | Hides the Who to follow (and You might like) and What's happening cards (both by default), and Today's News, from the column on the right. Not an Android patch |
| Customize timeline top bar | Hides For you, Following, pinned lists, communities and topics, and the Manage timelines (+) button; switches away from a hidden tab |
| Hide promote button | Hides Promote / Boost links on your posts and in their menu |
| Remove premium upsell | Turns off every `*upsell*` feature switch and the paywall switches, hides the Premium row, Subscribe cards and Get verified prompts |
| Hide Banner | Hides the *See new posts* pill |
| Hide Community Notes | Removes notes from responses and hides any left |
| Hide FAB | Hides the floating Post button |
| Hide badges from navigation bar icons | Zeroes the unread counts and hides the badges |
| Custom share menu | Hides post menu options by key, e.g. `NotInterested`, `Follow`, `AddToList`, `Mute`, `Block`, `ViewEngagements`, `Embed`, `Report`, `RequestCommunityNote`, `WhyThisAd`, `Pin`, `Highlight` |
| Share Tweet as Image | Adds *Share as image* to a post's share menu: renders a card, then share, copy or download it |
| Add ability to copy media link | Post menu: copies the original-size photo and best mp4 links |
| Support external downloader | Post menu: opens a downloader URL of your choice with the post link, or the system share sheet |
| Native reader mode | Post menu: the post's text, selectable, with its media links |
| Native translator | Post menu: opens Google Translate with the post's text |
| Enable debug menu for posts | Post menu: the post's full JSON |
| Native downloader | A download button on every post with media, and *Download media* in its share menu; original photos, best mp4s, no watermark |
| Custom download folder | Folder inside the browser's downloads folder (default `X`) |
| Custom sharing domain | Copied and shared links point at a domain of your choice (default `fxtwitter.com`) |
| Handle custom twitter links | Redirects pages on fxtwitter, vxtwitter, fixupx, xcancel and the like to the same path on x.com. Hosts you add are asked for access in the settings |
| Legacy share links | Copied post links name the author instead of `/i/status/` |
| No shortened URL | Links in posts and cards go to their real address instead of t.co |
| Enable Undo Posts | Holds each post for a few seconds with Undo and Send now. An undone post never leaves the browser; its text is copied to the clipboard |
| Unlock Premium checks | Turns on the site's own `subscriptions_feature_*` checks. What the server enforces still needs a subscription |
| Hook feature flag | Sets feature switches from `key=value` lines, in the boot state and in each request's `features` |
| Import/Export login token | Settings: export the x.com session cookies as text and import them in another browser. Treat the export like a password |
| Delete from database | Settings: clears what x.com keeps in IndexedDB and its service worker |

### Added on x.com

| Patch | On x.com |
| --- | --- |
| Inline replies | *Show replies* under every post with replies opens them right below it as a tree: no dialog, no leaving the timeline. Each reply sits under the one it answers, a level further in with a thread line (indenting stops after five levels), and any reply with replies of its own has its own *Show replies*, to any depth. *Load more* fetches the post's next page, *Show more replies* the rest of a thread, and *Expand all* opens everything shown, all the way down, before fetching the next page, three branches at a time, until the configured limit (default 100) counted over every level. Replies go through the same filters as timelines; what was loaded stays when the post scrolls away and back |
| Follow button on posts | A Follow button next to the author's name on posts by accounts you do not follow (not on your own posts, or accounts you block or that block you). It follows through the post's own menu, so x.com sends its usual request, and the button goes only once the server confirms the follow; protected accounts get a follow request. Unfollowing elsewhere brings the button back |

### Not carried over

Android side bar rows with no counterpart on x.com: Money, Sports, Offline videos, Boost. The home
top bar's Subscriptions and topics suggestion tabs do not exist on x.com either.

### Language

Most hooks use `data-testid`, links and ARIA roles, which do not change with the site's language. A
few post menu options have nothing but their text to go by, and only English text is matched:
*Not interested*, *Follow*, *Mute*, *Embed*, *Pin*, *Highlight*, *Promote*. The Manage timelines (+)
button is matched by its English label too.

## Development

```sh
npm test          # node's test runner over the transforms, the page hook and the reply tree
npm run lint      # web-ext lint
npm run start     # Firefox with the extension, reloading on change
npm run build     # zip, in web-ext-artifacts/
npm run sign      # Mozilla-signed .xpi (unlisted); needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET
```
