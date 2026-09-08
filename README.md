# oliverbar.net

A static site for Cloudflare Pages that looks like a blank black screen and does nothing visible — until you type a keyword. Backed by [oliverbar.net-api](https://github.com/skhshths/oliverbar.net-api), a Cloudflare Worker that keeps trigger words, layouts, chat, and self-serve pages in sync for every visitor rather than stuck in one browser.

All site files live under [`site/`](./site) — that's what gets uploaded to Cloudflare Pages. The Worker backend used to live alongside it in a `worker/` folder here; it's since moved to its own repo, [oliverbar.net-api](https://github.com/skhshths/oliverbar.net-api).

## How it works

`index.html` renders a solid black page with no visible UI at all — no input box, nothing to click. An invisible text input silently captures every keystroke into a rolling buffer. When that buffer ends with a known trigger word, you're redirected to the matching page. Trigger words and their on/off state are fetched from the Worker on load, so changes made in the admin panel apply to every visitor immediately, not just the browser that made them.

Built-in triggers:

| Trigger | Destination | Notes |
|---|---|---|
| `ADMIN` | Admin panel | Fixed — can't be renamed or disabled, even via the API (see below) |
| `interactive` | Drag-and-drop box builder | Toggleable, renameable |
| `portfolio` | Blank page | Toggleable, renameable |
| `chat` | Global chat room | Toggleable, renameable |
| *(any custom entry)* | Any path or external URL | Added from the admin panel |

## Pages

All under [`site/`](./site):

- **`index.html`** — the black entry screen described above.
- **`x913j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — **Admin**. Password-gated (client-side check; see Security below). Once unlocked, a sidebar splits everything into tabs instead of one long scroll:
  - **Site & Triggers** — the Interactive / Portfolio / Chat triggers as cards, toggle + rename each. The Admin card itself is grayed out and can't be edited.
  - **Custom Redirects** — your own trigger words pointing to any path on this site, a self-serve Custom Page, or any external URL.
  - **Custom Pages** — paste raw HTML and it's hosted directly by the Worker at a generated URL (no Cloudflare Pages redeploy needed). Slugs can be nested paths (e.g. `test/about-us`) so pages can link to each other. The generated link only works when reached through a trigger word — see below.
  - **Chat & Accounts** — the "Clear All Chat Messages" button, plus a list of every chat name that's been claimed with a PIN (see Global Chat below), with a Release button per name.
  - **Experimental** — extra, lower-stakes stuff: a live count of how many tabs currently have the site open, and a usage count per trigger word. More may show up here over time.
- **`x923j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — **Interactive**. A drag/resize box builder with a per-box CSS editor, gated by the same password. Layout is saved to the Worker so every visitor sees the same canvas.
- **`x933j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — **Portfolio**. Blank black page. `Enter` sends you home.
- **`x943j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — **Global Chat**. Enter a display name and a PIN, then post messages everyone currently on the page can see (polls the Worker every 3 seconds). No admin password needed to chat — but the first message sent under a given name claims it with that PIN, and every later message under that name must use the same PIN, so nobody else can post as you. Wrong PIN bounces you back to the name prompt instead of silently posting.

The four hidden pages are named with long random-looking filenames on purpose — the only supported way in is through the correct trigger word on `index.html`, not by guessing or browsing a directory listing.

## Why the admin trigger can't be locked out

Trigger words and enabled/disabled state used to be fully editable, including the admin entry — which meant it was possible to disable or rename your way out of the only page that could undo it. Now:

- The admin row's trigger field and toggle are grayed out and non-interactive in the UI.
- The Worker (see [oliverbar.net-api](https://github.com/skhshths/oliverbar.net-api)) hard-codes the admin trigger as `"ADMIN"` and forces it enabled on every save, no matter what a hand-crafted API request sends. This is the real backstop, enforced server-side.

## Why Custom Pages can't be opened directly

Custom Pages are served from `pages.oliverbar.net`, a different origin than this site, so the sessionStorage flag the built-in hidden pages use to block direct navigation and reloads (set here, checked there) can't reach it — origins don't share sessionStorage. Instead, right before navigating to one, the site asks the Worker to mint a short-lived, single-use access token and appends it to the URL; the Worker refuses to serve the page without a valid one, and consumes the token the moment it's checked either way. Practically: typing or bookmarking a Custom Page's URL directly does nothing (you land back on `/`), and so does reloading it — you have to come back through the trigger word each time, same as every other hidden page here. See [oliverbar.net-api](https://github.com/skhshths/oliverbar.net-api) for the token flow's other half.

## Deploying

1. Deploy [oliverbar.net-api](https://github.com/skhshths/oliverbar.net-api) first — you need its URL before the site has any shared/global state.
2. Paste that URL into the `API_BASE` constant near the top of each file that has one: `index.html`, the admin page, the interactive page, and the chat page.
3. In the Cloudflare dashboard: **Workers & Pages → your Pages project → Create deployment**, and upload every file in [`site/`](./site).

This deployment currently points at `api.oliverbar.net` / `pages.oliverbar.net` — two custom domains routed at the same Worker, purely so links copied from the admin panel read as content pages rather than raw API calls. Using a single domain for everything works too; see the API repo's README for the `PAGES_BASE` fallback.

## Security model, in one place

Every password check on this site (the editor, the admin panel) is plain client-side JavaScript — readable in page source by anyone. This is intentionally a casual, low-stakes gate, not real authentication, and every hidden page currently shares the same password. The Worker's write endpoints add a real server-side check (an `X-Edit-Key` header matched against a Cloudflare secret) that stops casual tampering via direct API calls, but the password itself is still just a string embedded in HTML. Don't put anything here you'd be upset to see leaked.

Other things worth knowing:

- **Chat names are claimed with a PIN, not a real login.** The PIN is hashed (never stored in the clear) and stops casual impersonation, but there's no rate limiting on guessing it, and a short PIN is guessable — see the API repo's README for the full picture, including the small race window if two people claim the same new name at the exact same moment.
- **Chat has zero rate limiting or moderation beyond that.** See the API repo's README for what that means in practice and what stronger options exist (Turnstile, Durable Objects) if you want them later.
- **Custom-page HTML is served as-is**, including any `<script>` tags. Since only someone with the admin password can create one, this is consistent with the rest of the site's trust model, but there's no sandboxing of what a custom page can do once visited.
- **The Custom Pages access token is a casual gate, same as everything else here** — it stops accidental bookmarking/reloading, not someone reading the client-side source and calling the token-minting endpoint themselves.
- **Custom redirects to a file on this same site don't automatically get the "block direct navigation" guard** the built-in hidden pages have — that logic lives inside each page's own code. To add it to a custom page, drop this near the top of its `<body>`:
  ```html
  <script>
    if (sessionStorage.getItem("unlockedAccess") !== "custom:YOUR_ENTRY_ID") {
      window.location.replace("/");
    } else {
      sessionStorage.removeItem("unlockedAccess");
    }
  </script>
  ```
- If two trigger words are suffixes of each other (e.g. `"cat"` and `"scat"`), whichever is checked first wins. The four built-in pages are checked before custom redirects.

## Color scheme

Dark gray + peach/orange (Claude-brand-inspired; third-party sourced hex values, not an official Anthropic export):

| Role | Hex |
|---|---|
| Page background | `#141413` |
| Panels | `#262624` |
| Box default fill | `#30302e` |
| Text | `#faf9f5` |
| Accent | `#d97757` |
| Accent hover | `#c96442` |
