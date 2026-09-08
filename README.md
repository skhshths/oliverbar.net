# oliverbar-hidden-site

A static site with hidden, keyword-triggered pages, backed by a small
Cloudflare Worker for anything that needs to be shared globally
(trigger words, box layouts, chat, self-serve custom pages).

## Structure

```
.
├── site/     Static files for Cloudflare Pages (index.html + hidden pages)
└── worker/   Cloudflare Worker + KV backend (x92-layout-api)
```

Each folder has its own README with full setup details:

- [`site/README.md`](./site/README.md) — what each page does, the
  trigger-word system, the admin panel, chat, and custom pages.
- [`worker/README.md`](./worker/README.md) — deploying the Worker,
  KV setup, secrets, and the API routes it exposes.

## Quick start

1. Deploy the Worker first (`worker/README.md`) — you'll need its URL
   before the site works with shared/global state.
2. Paste that URL into the `API_BASE` constant near the top of each
   HTML file in `site/` that has one (`index.html`, and the admin,
   interactive, and chat pages).
3. Upload everything in `site/` to Cloudflare Pages.

## Security model, in one place

Every password check in this project (the editor, the admin panel)
is plain client-side JavaScript — readable in page source by anyone.
This is intentionally a casual, low-stakes gate, not real
authentication. Don't put anything here you'd be upset to see leaked.
The Worker's write endpoints add a real server-side check (an
`X-Edit-Key` header matched against a Cloudflare secret), which stops
casual tampering via direct API calls, but the "password" itself is
still just a string embedded in HTML.

See the two READMEs for the specific limitations of each feature
(chat has no rate limiting or moderation; custom pages execute
whatever HTML/JS you paste into them; etc).
