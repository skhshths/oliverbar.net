# x92 Layout API (Cloudflare Worker + KV)

This is the tiny backend that lets your site's shared state — the
interactive page's box layout, the admin panel's trigger words, the
global chat, and any custom pages you author — be visible to every
visitor, instead of being stuck in each visitor's own browser
(`localStorage`).

It stores several JSON blobs in Cloudflare Workers KV:

- `GET /api/layout` / `POST /api/layout` — the interactive page's box layout.
- `GET /api/config` / `POST /api/config` — the four pages' trigger
  words and enabled/disabled state, plus custom redirects.
- `GET /api/chat` / `POST /api/chat` — the global chat's messages.
  **`POST` here has no password** — it's intentionally open to
  anyone who reaches the chat page. See the security notes below.
- `POST /api/chat/clear` — wipes all chat messages. Gated by
  `X-Edit-Key`, used by the admin panel's "Clear All Chat Messages"
  button.
- `GET /api/pages` / `POST /api/pages` — custom HTML pages you author
  from the admin panel, served back at `/page/<slug>` on this same
  Worker.

All the `POST` routes except chat require an `X-Edit-Key` header
matching the same `EDIT_PASSWORD` secret you set below.

You do **not** need D1, SQLite, or any SQL here — everything is a
handful of key/value pairs, and KV is the right tool for exactly that.

## Prerequisites

- [Node.js](https://nodejs.org) installed (any recent LTS version).
- A Cloudflare account (free tier is fine).

## Step-by-step

1. **Unzip this folder** and open a terminal inside it.

2. **Install dependencies** (this installs Wrangler, Cloudflare's CLI):
   ```
   npm install
   ```

3. **Log in to Cloudflare:**
   ```
   npx wrangler login
   ```
   This opens a browser window to authorize the CLI.

4. **Create the KV namespace** that will hold your layout:
   ```
   npx wrangler kv namespace create LAYOUT_KV
   ```
   This prints something like:
   ```
   { binding = "LAYOUT_KV", id = "a1b2c3d4e5f6..." }
   ```
   Copy that `id` value.

5. **Paste the id into `wrangler.jsonc`** — open the file and replace
   `PASTE_YOUR_KV_NAMESPACE_ID_HERE` with the id you just copied.

6. **Set your edit password as a secret** (don't hard-code it in the
   source — this keeps it out of your Worker's code):
   ```
   npx wrangler secret put EDIT_PASSWORD
   ```
   When prompted, enter the **same password** you use to unlock the
   editor on the page (`asdfasdfasdf`, unless you've since changed it
   in the front-end code — if you change one, change both).

7. **Deploy:**
   ```
   npx wrangler deploy
   ```
   Wrangler prints a URL that looks like:
   ```
   https://x92-layout-api.<your-subdomain>.workers.dev
   ```
   That's your API's address. Copy it.

8. **Wire it up to your pages** — this Worker now serves *four*
  pages in the site project, so the same URL needs to be pasted into
  **four** files. In each of `index.html`,
  `x923j1029jx1209x0f28j4f23fq28jc2q938jf.html` (interactive),
  `x913j1029jx1209x0f28j4f23fq28jc2q938jf.html` (admin), and
  `x943j1029jx1209x0f28j4f23fq28jc2q938jf.html` (chat), find:
   ```js
   const API_BASE = ""; // <-- paste your Worker URL here
   ```
   and paste your URL in, e.g.:
   ```js
   const API_BASE = "https://x92-layout-api.yoursubdomain.workers.dev";
   ```
   Re-upload the updated files to Cloudflare Pages (same drag-and-drop
   flow you already used).

## About the "custom pages" feature

The admin panel's "Custom Pages" section lets you paste raw HTML,
which gets stored in KV and served directly by this Worker at
`https://<your-worker-url>/page/<slug>` — no Cloudflare Pages
deployment needed. Slugs can be nested (`test`, `test/about-us`,
`test/about-us/team`, ...) — one or more lowercase/number/dash
segments separated by slashes, validated both when you type it in the
admin panel and again server-side. This deliberately avoids ever
putting a real Cloudflare API token in browser JavaScript: a token
with permission to deploy to your Pages project would let anyone who
reads your page's source redeploy your entire site, which is a much
larger risk than anything else in this project. Serving stored HTML
from the Worker sidesteps that entirely — the write is gated by the
same `EDIT_PASSWORD` secret as everything else, and the read is
public by design (since the whole point is for visitors to see the
page).

If a save fails, the admin panel now tells you exactly which page
(by number and slug) and what's wrong with it, instead of a generic
"Save failed" — useful since a single malformed entry used to block
the whole batch with no indication of which one was the problem.

## About the chat feature

`/api/chat`'s `POST` route has **no password check at all**, on
purpose — anyone who reaches the chat page should be able to post.
Worth knowing:

- There's no rate limiting. Someone could script requests directly to
  `/api/chat` (bypassing the page's UI entirely) and flood it with
  messages. The Worker caps stored messages at 200 (oldest drop off)
  and caps name/message length, which limits *storage* growth, but
  doesn't stop spam from filling that window.
- There's no moderation or profanity filtering.
- If you want real protection here, options include: adding Cloudflare
  Turnstile (a CAPTCHA-like challenge) in front of the POST, or moving
  to a Durable Object for per-IP rate limiting — both are meaningfully
  more setup than what's here now, and intentionally left out to keep
  this deployable in one pass.

That's it — no database server, no SQL, nothing to maintain. KV
handles replication and availability for you.

## How the security model works (and its limits)

- Reading the layout (`GET`) is intentionally public — anyone visiting
  the page needs to see the current version.
- Writing (`POST`) requires the `X-Edit-Key` header to match the
  `EDIT_PASSWORD` secret. The front-end sends this automatically once
  you've unlocked the editor with the password.
- This is a reasonable gate for a personal/hobby project, but it's not
  bank-grade security: the password travels in a plain HTTP header
  (mitigated by Cloudflare's automatic HTTPS, but still visible to
  anyone with access to the browser making the request), and there's
  no rate-limiting on guessing it. Don't store anything truly
  sensitive behind this.
- `Access-Control-Allow-Origin: "*"` is left wide open in the sample
  code so it works regardless of your Pages domain. Once you know your
  final `*.pages.dev` (or custom) domain, you can tighten this in
  `src/index.js` by replacing `"*"` with your exact domain — that
  stops *other* websites from silently issuing requests to your API
  using a visitor's browser, though it doesn't change what the
  password already protects.

## Updating the Worker later

Any time you edit `src/index.js` or `wrangler.jsonc`, redeploy with:
```
npx wrangler deploy
```
