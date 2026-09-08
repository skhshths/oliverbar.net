# Hello World → Four Hidden Pages + Global Admin, Chat & Self-Serve Pages

A static site (Bootstrap 5) for Cloudflare Pages, backed by a Cloudflare
Worker (`x92-layout-api`) for everything that needs to be shared
across every visitor rather than stuck in one browser.

## Pages

- **`index.html`** — a plain black screen, nothing visible on it at
  all. No visible input;
  keystrokes are captured invisibly. Typing a trigger word routes you
  to a hidden page. Trigger words and on/off state are loaded from
  the Worker, so admin changes apply for every visitor. Built-in
  triggers by default:
  - `ADMIN` → admin settings (fixed, see below)
  - `interactive` → the drag-and-drop / custom-CSS site builder
  - `portfolio` → a blank black page
  - `chat` → the global chat room
  - plus any custom redirects you add in the admin panel

- **`x923j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — the interactive
  builder page (unchanged): flag icon, password `asdfasdfasdf`,
  drag/resize boxes, real per-box CSS editor, refresh icon.

- **`x933j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — blank black
  page. `Enter` sends you home.

- **`x913j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — the **Admin
  page**. Password `asdfasdfasdf` (same as the interactive page, for
  simplicity). Once unlocked:
  - Admin / Interactive / Portfolio / Chat, each with a trigger word
    and on/off toggle — **except Admin's row, which is grayed out and
    can't be edited or disabled at all**, by design (see below).
  - **Custom Redirects** — your own trigger words pointing to any path
    on this site or any external URL.
  - **Custom Pages** — paste raw HTML, and it's hosted directly by
    the Worker (no Cloudflare Pages upload needed) at a generated URL
    you can plug into a Custom Redirect. Slugs can be nested paths
    (e.g. `test/about-us`), so one custom page can link to another
    to build out a mini multi-page section.
  - **Chat Moderation** — a "Clear All Chat Messages" button that
    wipes the shared chat for everyone (asks for confirmation first).

- **`x943j1029jx1209x0f28j4f23fq28jc2q938jf.html`** — **Global Chat**.
  Enter a display name, then send messages that everyone currently on
  this page can see (polls the Worker every 3 seconds). No password —
  intentionally open to anyone who reaches it.

## Why Admin can no longer be renamed or disabled

Earlier, the admin trigger word and its on/off toggle were editable —
which meant it was possible to accidentally lock yourself out
permanently (disable `ADMIN`, and there's no way back in, since
reaching the admin page requires typing that exact word). Now:

- The admin row's trigger-word field and toggle are both **disabled
  in the UI** — grayed out, not clickable, no explanatory text needed.
- The Worker **hard-codes** the admin trigger as `"ADMIN"` and forces
  `enabled: true` on every save, no matter what's submitted — even a
  hand-crafted API request can't change either one. This is enforced
  server-side, not just hidden in the UI.

## Two custom domains, one Worker

This project uses two custom domains pointing at the **same** Worker
(`api.oliverbar.net` for JSON endpoints, `pages.oliverbar.net` for
served custom-page HTML) — purely for tidiness, so links you copy out
of the admin panel read as content pages rather than API calls. Both
are added the same way: **Cloudflare dashboard → your Worker →
Settings → Domains & Routes → Add → Custom Domain.** You can just use
one domain for everything if you'd rather not bother with two — set
`PAGES_BASE` to an empty string in the admin page's script and it'll
fall back to `API_BASE` for page links too.

## Making it shared across all visitors

Same Worker as before, now handling four kinds of shared state (box
layout, site config, chat messages, custom pages). To wire it up:

1. Deploy/redeploy the Worker per the `x92-layout-api` README.
2. Paste its URL into the `API_BASE` constant in **four** files:
   `index.html`, the interactive page, the admin page, and the chat
   page.
3. Re-upload everything to Cloudflare Pages.

## Uploading new pages without touching Cloudflare's dashboard

You asked whether it's possible to add new HTML files to Cloudflare
directly from the site. The honest answer: not safely, the way you
might expect. Cloudflare's real "deploy a new file" API needs an
account-level API token, and putting that token in this site's
JavaScript would mean anyone who views page source could redeploy
your *entire* Cloudflare Pages project — a far bigger risk than
anything else here.

Instead, the **Custom Pages** section on the admin panel gets you the
practical result (write HTML from your site, publish it, reach it
with a trigger word) without that exposure: your HTML is stored in
Workers KV and served directly by the Worker at
`https://<your-worker-url>/page/<slug>`, gated by the same edit
password as everything else on the admin panel. Paste that generated
URL into a Custom Redirect's destination field, give it a trigger
word, and you're done — no dashboard visit required.

## Color scheme

Dark gray + peach/orange (Claude-brand-inspired, third-party sourced
hex values, not an official Anthropic export):

| Role | Hex |
|---|---|
| Page background | `#141413` |
| Panels | `#262624` |
| Box default fill | `#30302e` |
| Text | `#faf9f5` |
| Accent | `#d97757` |
| Accent hover | `#c96442` |

## Nested custom pages

A custom page's slug can include slashes — `test`, `test/about-us`,
`test/about-us/team` are all valid. To let one page link to another,
just write a normal link/button in the pasted HTML pointing at the
other page's full URL, e.g.:

```html
<a href="https://pages.oliverbar.net/page/test/about-us">About Us</a>
```

If you also want each nested page to refuse direct navigation (like
the built-in hidden pages do), see the guard snippet later in this
file — set it up per-page and have each page's own links set the
next page's flag before navigating, the same way `index.html` does
for the top-level pages.

## Important limitations

- **All password checks are client-side JavaScript** — readable in
  page source. This is a casual gate, not real authentication, and
  every hidden page currently shares the same password.
- **Chat has zero rate limiting or moderation** — see the
  `x92-layout-api` README for what that means in practice and what
  stronger options exist (Turnstile, Durable Objects) if you want them
  later.
- **Custom-page HTML you paste in gets served as-is** — including any
  `<script>` tags. Since only someone with the admin password can
  create one, this is consistent with the rest of the site's trust
  model (the password holder has full control), but worth knowing:
  there's no sandboxing of what a custom page can do once visited.
- **Custom redirects to a file on this same site don't automatically
  get the "block direct navigation" guard** the built-in hidden pages
  have — that logic lives inside each page's own code. If you want a
  custom page to have that same protection, add this near the top of
  its `<body>`:
  ```html
  <script>
    if (sessionStorage.getItem("unlockedAccess") !== "custom:YOUR_ENTRY_ID") {
      window.location.replace("/");
    } else {
      sessionStorage.removeItem("unlockedAccess");
    }
  </script>
  ```
  (For pages served via the new Custom Pages / Worker route, this
  guard still works exactly the same way, since it's just JavaScript
  running in the visitor's browser regardless of where the HTML came
  from.)
- If two trigger words happen to be suffixes of each other (e.g.
  `"cat"` and `"scat"`), whichever is checked first wins. Fixed pages
  are checked before custom redirects.

## Files

- `index.html`
- `x913j1029jx1209x0f28j4f23fq28jc2q938jf.html` (Admin)
- `x923j1029jx1209x0f28j4f23fq28jc2q938jf.html` (Interactive)
- `x933j1029jx1209x0f28j4f23fq28jc2q938jf.html` (Portfolio, blank)
- `x943j1029jx1209x0f28j4f23fq28jc2q938jf.html` (Global Chat)
- (separate project) `x92-layout-api/` — the Worker + KV backend

## Deploying the static site to Cloudflare Pages

1. Unzip this folder.
2. In the Cloudflare dashboard: **Workers & Pages → your Pages
   project → Create deployment** (drag and drop all the files).
3. Deploy.
