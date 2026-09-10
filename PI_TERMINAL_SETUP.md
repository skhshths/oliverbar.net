# Raspberry Pi terminal — setup runbook

A browser terminal into the Pi 5 at your house, reached from oliverbar.net by
typing the `pi5` trigger.

Nothing here opens a port on your router. The Pi dials *out* to Cloudflare and
holds that connection open; Cloudflare routes `pi.oliverbar.net` back down it.
Your home IP is never exposed.

```
browser ──► pi.oliverbar.net ──► Cloudflare Access (Google login)
                                        │
                                        ▼  (only if you pass)
                                 Cloudflare edge
                                        │
                                        ▼  outbound tunnel, already open
                                  cloudflared on the Pi
                                        │
                                        ▼  localhost only
                                   ttyd ──► login ──► your shell
```

---

## Read this part before you start

This gives a shell on a machine inside your house to anyone who gets past the
front door. Two independent locks stand in front of it:

1. **Cloudflare Access** — checks a Google login at Cloudflare's edge. Requests
   that fail never reach your Pi at all.
2. **`login`** — ttyd hands you the Pi's own login prompt, so a real Unix
   username and password are still required.

Two things make this materially safer, and they're worth doing:

- **Give the account a strong password.** It is now internet-reachable in
  effect. If it's still `raspberry`, change it: `passwd`.
- **Bind ttyd to loopback** (the config below does this). Nothing on your LAN
  can reach it directly either — the tunnel is the only way in.

**Kill switch:** `sudo systemctl stop cloudflared` severs all remote access
instantly. Everything else keeps running.

---

## 1. Check your architecture

```bash
dpkg --print-architecture
```

A Pi 5 on 64-bit Pi OS says `arm64`. If it says `armhf` you're on the 32-bit
build — substitute `armhf` for `arm64` in step 3.

---

## 2. Install ttyd

**Not via apt.** There is no `ttyd` package in Debian Bookworm, so
`apt install ttyd` fails with *"has no installation candidate"*. Grab the
official static binary instead — it bundles its own libwebsockets, so there are
no dependencies to chase:

```bash
sudo curl -fsSL -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.aarch64
sudo chmod +x /usr/local/bin/ttyd
ttyd --version
```

On 32-bit Pi OS (`dpkg --print-architecture` said `armhf`) use
`ttyd.armhf` instead of `ttyd.aarch64`.

This installs to `/usr/local/bin/ttyd`, which is the path the service unit in
step 6 uses.

**Note the version it prints.** From 1.7.0 onward ttyd is read-only unless you
pass `-W`, which is why that flag is in the unit file. If yours is 1.6.x or
older, drop the `-W` — it won't recognise the flag and won't start.

---

## 3. Install cloudflared

```bash
curl -L -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

---

## 4. Create the tunnel

```bash
cloudflared tunnel login
```

This prints a URL. Open it, and pick **oliverbar.net** from the list. It writes
a certificate to `~/.cloudflared/cert.pem`.

```bash
cloudflared tunnel create pi-terminal
```

It prints a UUID and the path to a credentials JSON file. **Copy that UUID** —
the next step needs it.

```bash
cloudflared tunnel route dns pi-terminal pi.oliverbar.net
```

That creates the DNS record for you. No dashboard clicking needed.

---

## 5. Configure the tunnel

Replace `<UUID>` with the one from step 4:

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: pi-terminal
credentials-file: /etc/cloudflared/<UUID>.json

ingress:
  - hostname: pi.oliverbar.net
    service: http://localhost:7681
  - service: http_status:404
EOF
sudo nano /etc/cloudflared/config.yml   # paste the real UUID into credentials-file
```

WebSocket upgrades pass through an `http://` ingress automatically — there's
nothing extra to enable for the terminal to work.

---

## 6. Run ttyd as a service

**ttyd** — note `-i lo`, which binds it to loopback so only cloudflared (running
on the same machine) can reach it. `login` runs as root purely so it can drop to
whichever user authenticates; your shell is *not* root unless you log in as root.

Let the shell fill in the binary's path rather than hardcoding it — that's
`$TTYD` below, and note this heredoc is deliberately unquoted so it expands:

```bash
TTYD=$(command -v ttyd) && echo "using $TTYD" && sudo tee /etc/systemd/system/ttyd.service >/dev/null <<EOF
[Unit]
Description=ttyd terminal server (loopback only)
After=network.target

[Service]
Type=simple
ExecStart=$TTYD -W -p 7681 -i lo -t fontSize=15 login
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

If that prints no path, ttyd isn't installed — go back to step 2.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ttyd
sudo systemctl status ttyd --no-pager
```

Keep extra `-t` client options simple. `ExecStart` supports quoted arguments,
but a value containing both spaces and commas (a CSS font stack, say) is a
needless thing to have to rule out when something else breaks. Add cosmetics
once the terminal is working.

Checkpoint. This is loopback only — nothing is exposed yet:

```bash
curl -sI http://localhost:7681 | head -1     # expect: HTTP/1.1 200 OK
```

**Do not start cloudflared yet.** The tunnel is what makes the Pi reachable and
Access is what stands in front of it, so Access goes on first. Do step 7, then
come back for step 8.

---

## 7. Put Cloudflare Access in front of it

**Do this before starting the tunnel.** An Access application is defined by
hostname and doesn't care whether the origin is live yet, so setting it up now
means `pi.oliverbar.net` is never a bare login prompt on the open internet —
not even for the minute it takes you to switch windows.

1. Go to **one.dash.cloudflare.com** → Zero Trust. First visit asks you to pick
   a team name and a plan — **choose Free** (50 users). It may ask for a card;
   the free plan doesn't charge it.
2. **Access → Applications → Add an application → Self-hosted.**
3. Application name: `Pi Terminal`. Session duration: **24 hours** is a
   reasonable balance.
4. Public hostname: subdomain `pi`, domain `oliverbar.net`.
5. Add a policy: name it `Me`, action **Allow**, and under Include choose
   **Emails** → `oliverbarnet12@gmail.com`.
6. Under login methods, pick your identity provider and save.

**On identity providers:** Google SSO needs a Google Cloud OAuth client set up
in Zero Trust first — a few extra minutes. **One-time PIN** works with zero
configuration (Cloudflare emails you a 6-digit code) and is exactly as strong
for a single-user allowlist. If you want this working tonight, start with
One-time PIN and swap to Google later; the policy stays the same.

Verify: open `https://pi.oliverbar.net` in a private window. You should hit
Cloudflare's login page, *not* a terminal. At this stage you'll see that login
even though the tunnel isn't running — Access intercepts at Cloudflare's edge,
before anything is asked of your origin. That's the proof it's working.

---

## 8. Start the tunnel

Now that Access is in front of it:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

Confirm it actually connected — the CONNECTIONS column should no longer be
empty:

```bash
cloudflared tunnel list
```

Until an instance connects, `pi.oliverbar.net` returns **HTTP 530**. That error
means "this hostname routes to a tunnel, but nothing is attached to it," and it
is the expected state right up until this step.

---

## 9. Use it

Go to oliverbar.net and type **`pi5`**.

The first time, the page shows a sign-in card. Cloudflare's login screen refuses
to be framed (deliberately — it's an anti-clickjacking measure), so that one
login has to happen in its own tab. Click **Open in a new tab**, sign in, then
come back. The session cookie is shared across `oliverbar.net`, so from then on
the terminal loads inline and stays that way until the session expires.

The bar along the top has:

- a **status dot** — green means the tunnel answered, red means `cloudflared` or
  `ttyd` is down on the Pi. It only reports reachability; it can't see inside
  the terminal.
- **Sign in** — reopens the Access login in a tab when your session lapses.
- **Reload** — re-handshakes the WebSocket after a dropped connection.
- **Fullscreen**.

You can rename the `pi5` trigger from the admin panel under Site & Triggers, or
disable the page there entirely.

---

## Troubleshooting

| What you see | Where to look |
|---|---|
| `apt`: ttyd *has no installation candidate* | Expected — it isn't packaged for Bookworm. Use the binary in step 2 |
| `ttyd: command not found` after install | `ls -l /usr/local/bin/ttyd`; check it's executable |
| Unit fails, `status=203/EXEC` | `ExecStart` path wrong — should be `/usr/local/bin/ttyd` |
| `HTTP 530` from pi.oliverbar.net | No tunnel connected. `sudo systemctl status cloudflared`, then `cloudflared tunnel list` |
| Tunnel authenticates as `<UUID>` | `credentials-file` in config.yml still has the placeholder |
| Red dot, terminal blank | `sudo systemctl status cloudflared ttyd` |
| `502 Bad Gateway` | ttyd isn't listening. `curl -sI http://localhost:7681` |
| Terminal shows but typing does nothing | Missing `-W` on ttyd 1.7+ |
| Frame stays blank, new tab works | Access session expired — hit **Sign in** |
| DNS doesn't resolve | `cloudflared tunnel route dns pi-terminal pi.oliverbar.net` again |
| Want live logs | `journalctl -u cloudflared -f` / `journalctl -u ttyd -f` |

Confirm the tunnel is registered and healthy from the Pi:

```bash
cloudflared tunnel info pi-terminal
```

---

## If you want to tighten it further

- **A dedicated user.** Make a `console` account without sudo, and have ttyd run
  `login -f console`. A compromised session then can't escalate.
- **Shorten the Access session** to 1 hour, or require re-auth on every visit.
- **Country restriction.** Add a Require block to the Access policy limiting it
  to your country — cheap, and it removes most drive-by traffic.
- **Audit trail.** Zero Trust → Logs → Access shows every login attempt against
  the hostname, allowed and blocked.
