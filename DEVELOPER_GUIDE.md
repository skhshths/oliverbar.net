# Developer Guide — oliverbar.net

This is a step-by-step manual for understanding, running, and extending
this project. It covers both repositories, how they talk to each
other, every stored piece of data, every API route, and worked
examples for the kinds of changes people actually make (new pages, new
endpoints, new admin tabs).

If you're new here: read **Part 1** first. Everything else is
reference material you'll come back to.

## Table of contents

- [Part 1 — The big picture](#part-1--the-big-picture)
- [Part 2 — Repository map](#part-2--repository-map)
- [Part 3 — Core concepts](#part-3--core-concepts)
- [Part 4 — Data model (everything in KV)](#part-4--data-model-everything-in-kv)
- [Part 5 — API reference](#part-5--api-reference)
- [Part 6 — Local development](#part-6--local-development)
- [Part 7 — Deploying](#part-7--deploying)
- [Part 8 — Walkthroughs: making common changes](#part-8--walkthroughs-making-common-changes)
- [Part 9 — Security model, in full](#part-9--security-model-in-full)
- [Part 10 — Troubleshooting](#part-10--troubleshooting)

---

## Part 1 — The big picture

This is a personal, semi-hidden website. To an outside visitor,
`oliverbar.net` is a plain black screen — no visible UI, nothing to
click. Typing a secret word anywhere on the page (there's an invisible
text input capturing every keystroke) redirects you to a hidden page:
an admin panel, a drag-and-drop layout builder, a blank "portfolio"
page, or a chat room with direct messages. What word does what, and
whether a given page is even turned on, is controlled from the admin
panel and applies to *every visitor immediately* — not just your own
browser.

That "applies to every visitor" part is the whole reason a backend
exists at all. Two repositories make up the project:

| Repo | What it is | Where it runs |
|---|---|---|
| [`oliverbar.net`](https://github.com/skhshths/oliverbar.net) | The static site — every HTML file a visitor's browser loads | [Cloudflare Pages](https://pages.cloudflare.com/) |
| [`oliverbar.net-api`](https://github.com/skhshths/oliverbar.net-api) | One Cloudflare Worker + one KV namespace — the entire backend | [Cloudflare Workers](https://workers.cloudflare.com/) |

There is no database server, no build step, no framework, no npm
dependencies in the site at all beyond Bootstrap's CSS (used for one
`<link>` tag and unused otherwise). Every page is a single self-contained
`.html` file with inline `<style>` and `<script>`. The Worker is a
single `index.js` file with no dependencies except Cloudflare's own
runtime APIs. This is deliberate — the whole project is meant to be
readable top-to-bottom and deployable by one person in an afternoon.

**How a request actually flows**, using "someone opens a DM":

```
Browser                    oliverbar.net (Pages)         oliverbar.net-api (Worker)        KV
   |                              |                              |                          |
   |  GET /                       |                              |                          |
   |----------------------------->|                              |                          |
   |  <-- index.html, x943...html |                              |                          |
   |<-----------------------------|                              |                          |
   |                              |                              |                          |
   |  types "chat", buffer        |                              |                          |
   |  matches -> redirect         |                              |                          |
   |                              |                              |                          |
   |  fetch /api/chat/login       |                              |                          |
   |------------------------------------------------------------>|  read/write chat_names   |
   |                              |                              |------------------------->|
   |  <-- { token, name }         |                              |<-------------------------|
   |<------------------------------------------------------------|                          |
   |                              |                              |                          |
   |  fetch /api/dm/messages      |                              |  read dm_conversations,  |
   |  (X-Chat-Session: token)     |                              |  dm_messages, dm_read    |
   |------------------------------------------------------------>|------------------------->|
   |  <-- { messages, reads }     |                              |<-------------------------|
   |<------------------------------------------------------------|                          |
```

Every page the site serves is static — Cloudflare Pages just hands out
files. All the "does this look different for different people / does
this remember anything" behavior comes entirely from the Worker.

---

## Part 2 — Repository map

### `oliverbar.net` (the site)

```
oliverbar.net/
├── README.md
├── DEVELOPER_GUIDE.md          <- this file
└── site/                        <- uploaded to Cloudflare Pages, as-is
    ├── index.html                       the black entry screen
    ├── x913j1029j...jf.html             Admin panel
    ├── x923j1029j...jf.html             Interactive box builder
    ├── x933j1029j...jf.html             Portfolio (blank page)
    └── x943j1029j...jf.html             Chat (global + DMs)
```

The four hidden pages are named with long, random-looking filenames on
purpose — reaching them is only supported through the correct trigger
word on `index.html`, not by guessing a URL or browsing a directory
listing (Cloudflare Pages doesn't expose directory listings anyway,
but the naming is an extra deterrent against someone finding these by
accident).

Every file that talks to the backend defines two constants near the
top of its `<script>` block:

```js
const API_BASE = "https://api.oliverbar.net";   // the Worker's URL
const PAGES_BASE = "https://pages.oliverbar.net"; // same Worker, second domain (see Part 3)
```

If you fork this project or stand up your own instance, these are the
two lines you change in **every** file that has them (`index.html`,
both hidden-page files that call the API, and the admin/chat pages).

### `oliverbar.net-api` (the Worker)

```
oliverbar.net-api/
├── README.md
├── index.js          <- the entire backend, one file
├── wrangler.jsonc     <- Worker config: name, KV binding, compatibility date
└── package.json       <- just enough to `npm install` Wrangler
```

`index.js` is one big `export default { async fetch(request, env) {...} }`.
Inside, it's a long sequence of:

```js
if (url.pathname === "/api/whatever" && request.method === "POST") {
  // ...handle it, return a Response
}
```

There's no router library — matching pathname + method by hand is
simple enough at this scale, and keeps the whole file greppable. New
routes get added the same way; see [Part 8](#part-8--walkthroughs-making-common-changes).

---

## Part 3 — Core concepts

These four ideas explain almost everything non-obvious in the code.

### 3.1 — The trigger word system

`index.html` has one `<input>` that's visually invisible
(`opacity: 0`, 1px×1px, `pointer-events: none`) but always focused. As
you type, each keystroke is appended to an in-memory string (`buffer`,
trimmed to the longest known trigger word's length). After every
keystroke, `checkTriggers()` checks whether `buffer` **ends with** any
known trigger word. If it does, the browser navigates to that word's
destination.

The list of trigger words is fetched from `GET /api/config` on page
load — so this list, and whether each one is turned on, is the same
for every visitor and can be changed live from the admin panel.

### 3.2 — Two kinds of "you're not allowed to just load this page" guard

Every hidden page needs to refuse being reached by typing its URL
directly, or by reloading it. There are two different mechanisms for
this, because there are two different situations:

**Same-origin (the four built-in hidden pages, all served from
`oliverbar.net`):** `index.html` sets a flag in `sessionStorage` right
before navigating —

```js
sessionStorage.setItem("unlockedAccess", "chat");
window.location.href = "/x943....html";
```

— and the target page checks it immediately on load, then deletes it:

```js
if (sessionStorage.getItem("unlockedAccess") !== "chat") {
  window.location.replace("/");
}
sessionStorage.removeItem("unlockedAccess");
```

Because the flag is deleted the instant it's read, a reload of the
same page finds it missing and bounces home. This works because
`sessionStorage` is shared within one origin (`oliverbar.net`) —
setting it on `index.html` and reading it on the hidden page works
because they're the same site.

**Cross-origin (Custom Pages, served from `pages.oliverbar.net`):**
`sessionStorage` does **not** cross origins, so the trick above can't
reach a page hosted on a different domain, even if it's technically
the same Worker underneath. Instead, the site asks the Worker for
permission right before navigating:

```js
// on oliverbar.net, right before navigating to a pages.oliverbar.net URL
const { token } = await fetch(API_BASE + "/api/pages/token", {
  method: "POST",
  body: JSON.stringify({ slug: "my-page" })
}).then(r => r.json());
window.location.href = destination + "?t=" + token;
```

The Worker stores that token in KV with a 60-second expiry
(`page_token:<token> → {slug}`). When `GET /page/<slug>` is requested,
it looks for `?t=`, checks the token is valid **and** matches the
requested slug, and — this is the important part — **deletes the
token the instant it's checked, whether or not it was valid.** So a
reload sends the exact same URL with the exact same (now-consumed)
token, which fails the check and bounces home. Same end-user behavior
as the sessionStorage trick, implemented differently because it has to
cross an origin boundary.

Both mechanisms are what this whole project calls a **casual gate**:
they stop accidental bookmarking and reloading. Neither stops someone
who reads the JavaScript source (which is trivial — it's a public
website) from replicating the flow themselves. That's an accepted
trade-off, documented throughout the code, not an oversight.

### 3.3 — Chat identity: login once, session everywhere

Chat doesn't have real accounts with passwords in the traditional
sense. Instead:

1. `POST /api/chat/login` with `{name, pin}`. If `name` has never been
   used before (checked case-insensitively), this **claims** it — the
   PIN is hashed (PBKDF2-SHA256, random salt) and stored. If the name
   is already claimed, the PIN must match the one it was claimed with.
2. Either way, a successful login returns a **session token**
   (`chat_session:<token>`, valid 7 days).
3. Every other chat/DM endpoint expects that token in an
   `X-Chat-Session` header, and derives your display name from it
   server-side. The client never gets to just *say* who it is when
   posting a message — it has to prove it via the token.
4. The chat page saves `{token, name}` to `localStorage`, so
   reopening the page can silently check `GET /api/chat/session` and
   skip straight past the login prompt if the token's still good. This
   is what makes "log back in and see your history" work — the
   history was always server-side, keyed by your name; the token is
   just how the Worker knows which name you are.

This is the same pattern used everywhere in the project: a short-lived
credential that proves "you did the real check a moment ago," so you
don't have to redo the real check on every single request.

### 3.4 — DM conversations aren't pairs, they're groups of any size

A direct message conversation is identified by a random id
(`convId`), not by who's in it. `dm_conversations:<convId>` stores the
participant list. This is what lets a "1:1 DM" and a "group DM" be the
exact same code path — a 1:1 is just a conversation with 2
participants.

To avoid creating a new conversation every time the same two (or
three, or four) people message each other, `POST /api/dm/start`
normalizes and sorts the requested participant list (plus yourself)
into a comparable key, and reuses an existing conversation with that
exact same participant set if one's already in your thread list.

---

## Part 4 — Data model (everything in KV)

Cloudflare KV is a flat key→value store — no tables, no schema
enforcement, no relations. Every value here is a JSON string. This
section is the actual schema, since KV itself won't tell you.

| Key | Shape | Written by | Notes |
|---|---|---|---|
| `layout` | `Array<Box>` | Interactive page | The drag/resize canvas |
| `site_config` | `{ admin, interactive, portfolio, chat, custom: [] }` | Admin panel | Trigger words + on/off + custom redirects |
| `chat_messages` | `Array<Message>` | Global chat | Capped at 200, oldest dropped |
| `chat_pinned` | `Array<{id,name,text,ts,pinnedAt}>` | Admin (pin/unpin) | Snapshots, not live references |
| `chat_names` | `{ [lowerName]: Account }` | Login/claim, profile, block | See below for `Account` shape |
| `chat_session:<token>` | `{ name }` | Login | TTL 7 days |
| `chat_presence:<lowerName>` | `"1"` | Chat page heartbeat | TTL 30s — "online now" |
| `typing:global:<lowerName>` | name (string) | Chat page, on keystroke | TTL 5s |
| `typing:dm:<convId>:<lowerName>` | name (string) | Chat page, on keystroke | TTL 5s |
| `dm_conversations:<convId>` | `{ id, participants: [names], createdAt }` | `/api/dm/start` | `participants` includes everyone, canonical casing |
| `dm_messages:<convId>` | `Array<Message>` | `/api/dm/send` | Capped at 300 |
| `dm_threads:<lowerName>` | `Array<{convId, participants, lastTs, lastText, lastFrom}>` | Every send, for every participant | One person's inbox index |
| `dm_read:<convId>:<lowerName>` | timestamp (string) | `/api/dm/read` | Backs read receipts |
| `lifetime_stats` | `{ totalGlobalMessages, totalDmMessages, totalAccountsCreated }` | Every send/claim | Survives the capped arrays above rolling old entries off |
| `custom_pages` | `Array<{slug, html}>` | Admin panel | Served at `/page/<slug>` |
| `page_token:<token>` | `{ slug }` | `/api/pages/token` | TTL 60s, single-use |
| `trigger_stats` | `{ [slug]: count }` | `index.html`, every trigger match | |
| `presence:<id>` | `"1"` | `index.html` heartbeat | TTL 30s — anonymous tab counter, unrelated to `chat_presence` |

**`Message` shape** (used identically by `chat_messages` and every
`dm_messages:<convId>`):

```json
{
  "id": "a1b2c3d4e5f6",
  "name": "Alice",            // global chat uses "name"; DMs use "from" instead
  "text": "hey!",
  "ts": 1735689600000,
  "edited": false,             // optional, only present once edited
  "deleted": false,            // optional; when true, text is null
  "reactions": { "👍": ["Bob", "Carol"] }
}
```

**`Account` shape** (one entry inside the `chat_names` blob, keyed by
lowercased name):

```json
{
  "name": "Alice",
  "saltHex": "…",
  "hashHex": "…",
  "createdAt": 1735689600000,
  "avatar": "🦊",
  "status": "at the gym",
  "blocked": ["someannoyingperson"]
}
```

`chat_names` is a **single JSON blob** containing every account, not
one KV key per account. That's fine at personal-project scale (dozens
of accounts, not millions) and keeps "list every account" a single KV
read. If this ever needs to scale past that, splitting it into
per-account keys (`chat_name:<lowerName>`) is the first thing to
change — see [Part 10](#part-10--troubleshooting).

---

## Part 5 — API reference

All routes are on the Worker. Base URL in production is
`https://api.oliverbar.net` (JSON) and `https://pages.oliverbar.net`
(same Worker, used only for `/page/<slug>` links so they read as
content rather than API calls).

Every response is JSON except `GET /page/<slug>`, which returns raw
HTML. Every route accepts `OPTIONS` for CORS preflight.

**Auth column key:**
- `none` — no header required
- `X-Edit-Key` — must equal the `EDIT_PASSWORD` secret
- `X-Chat-Session` — must be a token from `/api/chat/login`

### Site & layout

| Route | Method | Auth | Body / Query | Response |
|---|---|---|---|---|
| `/api/layout` | GET | none | — | The box layout array |
| `/api/layout` | POST | `X-Edit-Key` | the layout array | `{ok:true}` |
| `/api/config` | GET | none | — | `{admin, interactive, portfolio, chat, custom}` |
| `/api/config` | POST | `X-Edit-Key` | same shape | `{ok:true}` — admin's `trigger`/`enabled` are force-overwritten server-side no matter what's sent |

### Chat identity

| Route | Method | Auth | Body / Query | Response |
|---|---|---|---|---|
| `/api/chat/login` | POST | none | `{name, pin}` | `{token, name}` — claims `name` if new, verifies PIN if not |
| `/api/chat/session` | GET | `X-Chat-Session` | — | `{name}` or 401 |
| `/api/chat/change-pin` | POST | `X-Chat-Session` | `{newPin}` | `{ok:true}` |
| `/api/chat/release-me` | POST | `X-Chat-Session` | — | `{ok:true}` — deletes your account, kills the session |
| `/api/chat/profile` | GET | `X-Chat-Session` | `?names=a,b,c` | `{a:{name,avatar,status}\|null, ...}` |
| `/api/chat/profile` | POST | `X-Chat-Session` | `{avatar, status}` | `{ok:true,avatar,status}` |
| `/api/chat/block` | POST | `X-Chat-Session` | `{name}` | `{ok:true}` |
| `/api/chat/unblock` | POST | `X-Chat-Session` | `{name}` | `{ok:true}` |
| `/api/chat/blocks` | GET | `X-Chat-Session` | — | `Array<lowerName>` |
| `/api/chat/presence` | POST | `X-Chat-Session` | — | `{ok:true}` — refresh your "online" flag |
| `/api/chat/presence` | GET | `X-Chat-Session` | `?names=a,b,c` | `{a:true/false, ...}` |
| `/api/typing` | POST | `X-Chat-Session` | `{scope:"global"\|"dm", convId?}` | `{ok:true}` |
| `/api/typing` | GET | `X-Chat-Session` | `?scope=global` or `?scope=dm&convId=` | `Array<name>` (excludes yourself) |

### Global chat

| Route | Method | Auth | Body / Query | Response |
|---|---|---|---|---|
| `/api/chat` | GET | none | — | `Array<Message>` |
| `/api/chat` | POST | `X-Chat-Session` | `{text}` | `{ok:true, name, id}` |
| `/api/chat/edit` | POST | `X-Chat-Session` | `{messageId, text}` | `{ok:true}` — must own the message |
| `/api/chat/delete` | POST | `X-Chat-Session` | `{messageId}` | `{ok:true}` — soft delete |
| `/api/chat/react` | POST | `X-Chat-Session` | `{messageId, emoji}` | `{ok:true, reactions}` — toggles |
| `/api/chat/pinned` | GET | none | — | `Array<PinnedMessage>` |
| `/api/chat/pin` | POST | `X-Edit-Key` | `{messageId}` | `{ok:true}` |
| `/api/chat/unpin` | POST | `X-Edit-Key` | `{messageId}` | `{ok:true}` |
| `/api/chat/clear` | POST | `X-Edit-Key` | — | `{ok:true}` — wipes messages **and** pins |

### Direct messages

| Route | Method | Auth | Body / Query | Response |
|---|---|---|---|---|
| `/api/dm/start` | POST | `X-Chat-Session` | `{participants: [names]}` | `{convId, participants}` — reuses an existing conversation if the participant set matches |
| `/api/dm/send` | POST | `X-Chat-Session` | `{convId, text}` | `{ok:true, id}` |
| `/api/dm/threads` | GET | `X-Chat-Session` | — | `Array<{convId, participants, lastTs, lastText, lastFrom}>` |
| `/api/dm/messages` | GET | `X-Chat-Session` | `?convId=` | `{messages, participants, reads}` |
| `/api/dm/edit` | POST | `X-Chat-Session` | `{convId, messageId, text}` | `{ok:true}` |
| `/api/dm/delete` | POST | `X-Chat-Session` | `{convId, messageId}` | `{ok:true}` |
| `/api/dm/react` | POST | `X-Chat-Session` | `{convId, messageId, emoji}` | `{ok:true, reactions}` |
| `/api/dm/read` | POST | `X-Chat-Session` | `{convId}` | `{ok:true}` — marks read up to now |

### Admin-only account management

| Route | Method | Auth | Body / Query | Response |
|---|---|---|---|---|
| `/api/chat/names` | GET | `X-Edit-Key` | — | `Array<{name,createdAt,avatar,status}>` |
| `/api/chat/names/release` | POST | `X-Edit-Key` | `{name}` | `{ok:true}` — frees a name |
| `/api/admin/dashboard` | GET | `X-Edit-Key` | — | `{totalGlobalMessages, totalDmMessages, totalAccounts, topTrigger, liveNow}` |

### Custom pages, tokens, and the two "fun" trackers

| Route | Method | Auth | Body / Query | Response |
|---|---|---|---|---|
| `/api/pages` | GET | none | — | `Array<{slug,html}>` |
| `/api/pages` | POST | `X-Edit-Key` | the array | `{ok:true}` |
| `/api/pages/token` | POST | none | `{slug}` | `{token}` — TTL 60s, single-use |
| `/page/<slug>` | GET | `?t=` token | — | Raw HTML, or a 302 to the homepage |
| `/api/stats/trigger` | POST | none | `{slug}` | `{ok:true}` — fire-and-forget counter |
| `/api/stats/trigger` | GET | `X-Edit-Key` | — | `{[slug]: count}` |
| `/api/presence/ping` | POST | none | `{id}` | `{ok:true}` |
| `/api/presence/count` | GET | `X-Edit-Key` | — | `{count}` |

---

## Part 6 — Local development

You can run the Worker locally with Wrangler's built-in dev server,
without touching production data:

```bash
cd oliverbar.net-api
npm install
```

Create a `.dev.vars` file (already gitignored — never commit this) so
`EDIT_PASSWORD` is set locally:

```
EDIT_PASSWORD=asdfasdfasdf
```

Then:

```bash
npx wrangler dev --port 8787
```

This spins up a fully local KV namespace — nothing you do here touches
the real, deployed KV data. `Ctrl+C` to stop it.

To test the **site** against your local Worker instead of production,
copy the `site/` folder somewhere, find/replace
`https://api.oliverbar.net` with `http://localhost:8787` and
`https://pages.oliverbar.net` with an empty string (so it falls back
to `API_BASE`), then serve that copy with any static file server, e.g.:

```bash
python3 -m http.server 8000
```

and open `http://localhost:8000`. **Never commit files with the local
URL swapped in** — always revert to the production `API_BASE` /
`PAGES_BASE` before pushing.

There's no local dev server for the site's actual production
deployment (Cloudflare Pages) — pushing to `main` and letting
Cloudflare's Git integration build it is the normal workflow (see Part
7).

---

## Part 7 — Deploying

Both repos are connected to Cloudflare's **Git integration**, so
**pushing to `main` deploys automatically.** You should rarely need to
deploy manually, but here's both paths.

### Deploying the Worker (`oliverbar.net-api`)

- **Automatic:** push to `main`. Cloudflare runs `npx wrangler deploy`
  for you (Workers Builds). Check the deploy succeeded under
  **Cloudflare dashboard → Workers & Pages → x92-layout-api →
  Deployments**.
- **Manual:** `npx wrangler deploy` from inside the repo, after
  `npm install` and `npx wrangler login`.

If you're standing up a **separate instance** rather than deploying to
the existing `x92-layout-api` Worker:

1. `npx wrangler kv namespace create LAYOUT_KV` — copy the printed
   `id` into `wrangler.jsonc`.
2. `npx wrangler secret put EDIT_PASSWORD` — set it to whatever the
   site's password checks expect.
3. `npx wrangler deploy`.
4. If you want custom domains like `api.` / `pages.` subdomains:
   **Cloudflare dashboard → your Worker → Settings → Domains &
   Routes → Add → Custom Domain.**

### Deploying the site (`oliverbar.net`)

- **Automatic:** push to `main`. Cloudflare Pages picks it up.
- **Manual:** **Cloudflare dashboard → Workers & Pages → your Pages
  project → Create deployment**, drag-and-drop everything in `site/`.

### Wiring the two together

Whenever you deploy your **own** Worker instance (a different URL than
`api.oliverbar.net`), you must update `API_BASE` (and `PAGES_BASE` if
you're using a second custom domain) in every site file that has it —
currently `index.html`, the admin page, and the chat page — then push
the site again.

---

## Part 8 — Walkthroughs: making common changes

### 8.1 — Add a brand-new API endpoint

Say you want `GET /api/hello` that just returns a greeting. In
`index.js`, add a block anywhere inside `fetch()` before the final
`return new Response("Not found", ...)`:

```js
if (url.pathname === "/api/hello" && request.method === "GET") {
  return new Response(JSON.stringify({ message: "hi!" }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
```

If it needs the newer helper style (shorter, used by everything added
after the chat/DM rewrite), use `respond()` instead, which already has
`corsHeaders` baked in:

```js
if (url.pathname === "/api/hello" && request.method === "GET") {
  return respond({ message: "hi!" });
}
```

If it should require the admin password: `const guard =
requireEditKey(request); if (guard) return guard;` at the top. If it
should require a logged-in chat session: `const name =
getSessionName(request, env); const guard = requireSession(name); if
(guard) return guard;`.

Then, from any site page, call it the same way every other route is
called:

```js
fetch(API_BASE + "/api/hello").then(r => r.json()).then(data => console.log(data.message));
```

Commit and push both repos (Worker first, ideally, so the endpoint
exists before any client code tries to call it — though in practice a
few seconds' gap between the two deploys is harmless for anything not
already live).

### 8.2 — Add a new hidden page

1. Create a new HTML file in `site/` with a similarly unguessable name
   (or just something private-looking — the *mechanism*, not the
   filename, is what protects it).
2. At the top of its `<script>`, add the same direct-access guard every
   other hidden page uses:
   ```js
   if (sessionStorage.getItem("unlockedAccess") !== "yourslug") {
     window.location.replace("/");
   }
   sessionStorage.removeItem("unlockedAccess");
   ```
3. In `index.html`, either:
   - Add it to the hardcoded `TARGETS` object (for a built-in,
     always-present page — requires also adding it to `DEFAULT_CONFIG`
     and the admin panel's `PAGE_ORDER`/`PAGE_LABELS` in the Worker and
     admin page, respectively), **or**
   - More simply: add it as a **Custom Redirect** from the admin
     panel, trigger word pointing at `/yourfile.html` — no code
     changes needed at all for this path.

### 8.3 — Add a new admin tab

Follow the existing pattern in `x913...html` (the admin page):

1. Add a button to `#admin-nav`:
   ```html
   <button class="nav-btn" data-tab="mytab">My Tab</button>
   ```
2. Add a matching `<section class="tab-panel hidden" data-tab="mytab">`
   inside `#admin-content` with whatever markup you need.
3. If it needs to load data when opened, add a case to `switchTab()`:
   ```js
   } else if (tab === 'mytab') {
     fetchMyTabData();
   }
   ```
4. `switchTab()` already handles showing/hiding based on `data-tab`
   matching — you don't need to touch that logic.

### 8.4 — Change the shared password

The site's client-side password checks (`ADMIN_PASSWORD` in the admin
page, `EDIT_PASSWORD` in the interactive page) are plain strings in
the HTML — searchable and replaceable with any text editor. If you
change one, **you must also update the Worker's `EDIT_PASSWORD`
secret** to match (`npx wrangler secret put EDIT_PASSWORD`), since
that's the value actually checked server-side on every write.

### 8.5 — Raise a limit (message length, PIN length, group size, etc.)

Every limit lives as a named constant at the top of `index.js` —
`MAX_MESSAGE_LENGTH`, `MAX_NAME_LENGTH`, `MIN_PIN_LENGTH`/
`MAX_PIN_LENGTH`, `MAX_GROUP_PARTICIPANTS`, `MAX_STATUS_LENGTH`,
`MAX_AVATAR_LENGTH`, and so on. Change the constant, redeploy. Several
of these are mirrored as `maxlength` attributes on the corresponding
`<input>` in the site's HTML — update those too so the UI doesn't
silently truncate below what the server would now accept.

---

## Part 9 — Security model, in full

This project's stated philosophy, repeated in both READMEs, is:
**casual, not bank-grade.** Concretely:

- Every *client-side* password check (admin panel, interactive editor)
  is a plain string in HTML — visible to anyone who views source. It
  gates the UI, nothing more.
- Every *write* to shared state is additionally gated server-side by
  either `X-Edit-Key` (must match the `EDIT_PASSWORD` secret) or
  `X-Chat-Session` (must be a valid login token) — this is the real
  enforcement, since it can't be bypassed by editing client JavaScript.
- The admin trigger word (`"ADMIN"`) and its enabled state are
  hard-coded server-side and can never be changed via the API, even
  with a hand-crafted request — this is what prevents ever locking
  yourself out of the admin panel.
- Chat identity is a PIN-claimed name, not a real account system:
  PBKDF2-hashed, but with no rate-limiting on guesses and a possible
  short-PIN brute force. It stops casual impersonation, not a
  determined attacker.
- DMs are readable only by their participants (checked server-side),
  but stored as plain JSON — no end-to-end encryption, no protection
  beyond Cloudflare's own HTTPS in transit and whatever access
  controls exist on your Cloudflare account for data at rest.
- Custom Pages execute exactly the HTML/JS pasted into them — anyone
  who can reach the admin password can run arbitrary script in a
  visitor's browser. Consistent with the project's trust model (the
  password holder has full control) but worth knowing.
- Blocking is enforced server-side for 1:1 DMs only — not for groups,
  and not for global chat (which is filtered client-side, cosmetically,
  not actually hidden from the blocked person's ability to send).
- Nothing in this project has rate limiting. The READMEs repeatedly
  flag [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
  and [Durable Objects](https://developers.cloudflare.com/durable-objects/)
  as the "if you want this to be real" upgrades, intentionally left
  out to keep the project deployable by one person in one sitting.

If you're extending this project for anything beyond personal/hobby
use, treat every one of the above as a checklist of what to fix first.

---

## Part 10 — Troubleshooting

**"Could not detect a directory containing static files" on a
Cloudflare Worker build.** The Worker repo is missing `wrangler.jsonc`
and/or `package.json`, so Cloudflare's Git integration can't tell it's
a Worker and falls back to Pages-style static-site detection. Make
sure both files are committed at the repo root with `main` in
`wrangler.jsonc` pointing at `index.js`.

**Admin panel or chat page shows stale data / "Could not reach the
Worker."** Check `API_BASE` in that file's `<script>` still points at
a live Worker URL, and that the Worker's deploy actually succeeded
(Cloudflare dashboard → Deployments).

**A Custom Page link doesn't load, even right after creating it.**
Custom Page URLs are token-gated (Part 3.2) — they only work when
reached through a trigger word, never by opening the raw URL directly.
This is expected, not a bug.

**Someone claimed a chat name you wanted / lost your PIN.** As the
site owner: log into the admin panel → Chat & Accounts → Release next
to that name. As a regular user, `POST /api/chat/release-me` requires
being logged in as that name already (i.e. knowing the PIN) — if you
don't, only the admin can free it.

**Reactions/edits/pins aren't appearing on old messages.** Messages
sent before this feature set was deployed don't have an `id` field, so
they can't be targeted for edit/delete/react/pin. This is expected —
they'll just display normally, minus those controls.

**`chat_names` is a single growing JSON blob — is that going to be a
problem?** Not until you have hundreds+ of accounts (each one adds
maybe 150–250 bytes). If it ever becomes one, the fix is switching to
one KV key per account (`chat_name:<lowerName>`) and updating
`loadNames`/`saveNames` plus every route that currently mutates the
in-memory map — a bigger refactor than anything else in this guide,
worth doing deliberately rather than as a quick patch.

---

*This guide describes the state of the project as of the most recent
DM/reactions/dashboard feature set. If you've since changed the code
and this guide, keep them in sync — a stale developer guide is worse
than no guide.*
