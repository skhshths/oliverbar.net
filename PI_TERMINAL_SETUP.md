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

1. **An outer gate** — either Cloudflare Access, which checks a login at
   Cloudflare's edge so failed attempts never reach your Pi at all, or ttyd's
   own basic auth if Access isn't available to you. Step 7 covers both, and is
   candid about the difference.
2. **`login`** — ttyd hands you the Pi's own login prompt, so a real Unix
   username and password are still required regardless.

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

## 7. Put authentication in front of it

**Do this before starting the tunnel.** Step 8 is what makes the Pi publicly
reachable, so whatever is guarding it should already be in place — there's no
reason to accept even a few minutes of a bare shell on the open internet.

There are two ways to do this, and which one you get depends on something
outside your control.

### 7a. Cloudflare Access — better, but it may want a card

Access checks a login at Cloudflare's edge, so failed attempts never reach your
Pi at all. That's a genuine security difference, not a cosmetic one.

The Zero Trust **Free** plan covers 50 users at $0. However, signup can still
demand a payment method before it will let you in. If it does and you don't
want to provide one, skip to 7b — the plan itself is free, but the gate is
the gate.

1. **one.dash.cloudflare.com** → Zero Trust → pick a team name → **Free**.
2. **Access → Applications → Add an application → Self-hosted.**
3. Name `Pi Terminal`; session duration 24 hours is a reasonable balance.
4. Public hostname: subdomain `pi`, domain `oliverbar.net`.
5. Policy: name `Me`, action **Allow**, Include → **Emails** → your address.
6. Login method: **One-time PIN** needs no configuration at all (Cloudflare
   emails a 6-digit code) and is exactly as strong as Google SSO for a
   single-address allowlist. Google needs an OAuth client set up first.

Verify by opening `https://pi.oliverbar.net` in a private window: you should get
Cloudflare's login page, *not* a terminal — and you'll get it even though the
tunnel isn't running yet, because Access intercepts before your origin is ever
consulted. That's the proof it works.

### 7b. Two passwords, no Zero Trust

If Access is out of reach, put ttyd's own basic auth in front of the system
login. Two independent passwords, no account needed.

Be honest about the trade: without Access, every request *does* reach your Pi,
and ttyd itself becomes the outermost defence. That's weaker. It is not
nothing — but keep ttyd updated, because it's now exposed.

Generate a password, and put it in a password manager rather than anywhere it
might be logged:

```bash
openssl rand -base64 24
```

Rewrite the unit with `-c user:password` and `-m 2` to cap concurrent sessions:

```bash
sudo tee /etc/systemd/system/ttyd.service >/dev/null <<'EOF'
[Unit]
Description=ttyd terminal server (loopback only)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ttyd -W -p 7681 -i lo -m 2 -c oliver:PASSWORD_HERE -t fontSize=15 login
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo chmod 600 /etc/systemd/system/ttyd.service
sudo systemctl daemon-reload && sudo systemctl restart ttyd
```

The `chmod 600` is not optional — unit files are world-readable by default and
this one now holds a password.

Confirm the auth is actually enforced. This must return **401**, not 200:

```bash
curl -sI http://localhost:7681 | head -1
```

A 200 here means `-c` didn't take, and starting the tunnel would expose an
unauthenticated shell. Fix it before going on.

Then add a free WAF rule as a second layer: Cloudflare dashboard → **Security →
WAF → Custom rules**. Block anything to `pi.oliverbar.net` whose country isn't
yours. The free plan includes a handful of custom rules and this removes
essentially all drive-by scanning.

**To rotate the password later:**

```bash
NEW=$(openssl rand -base64 24) && sudo sed -i "s|-c oliver:[^ ]*|-c oliver:$NEW|" /etc/systemd/system/ttyd.service && sudo systemctl daemon-reload && sudo systemctl restart ttyd && echo "new password: $NEW"
```

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

## 10. Remote lockdown (optional)

A kill switch in the admin panel that stops `ttyd` on the Pi, dropping anyone
mid-session and refusing new connections until you unlock it. It works by
setting a flag in the Worker that a small poller on the Pi reads.

Understand the split before relying on it. The admin button and the terminal
page only ever set and reflect a flag; **stopping `ttyd` on the Pi is the part
that actually severs live sessions.** Without the poller below, "lockdown" only
blanks the website — a browser holding cached credentials for
`pi.oliverbar.net` sails right past it. The poller is the enforcement.

**Warning:** this installs a service whose job is to stop the very thing the web
terminal runs on. If you set it up *through* the web terminal, make sure you
have another way in first (SSH on your LAN, or a keyboard on the Pi). A lockdown
that leaves `ttyd` stopped locks you out of the web terminal until you unlock it
from a browser — and if the poller itself is wedged, until you reach the Pi
physically.

**The poller script** — polls the flag every 10s and starts/stops `ttyd` to
match. On a network error it leaves things exactly as they are, so a blip never
flips the state on its own:

```bash
sudo tee /usr/local/bin/pi-lockdown-check >/dev/null <<'EOF' && sudo chmod +x /usr/local/bin/pi-lockdown-check
#!/bin/bash
while true; do
  RESP=$(curl -fsS --max-time 10 https://api.oliverbar.net/api/pi/lockdown) || { sleep 10; continue; }
  case "$RESP" in
    *'"locked":true'*)  systemctl is-active --quiet ttyd && systemctl stop  ttyd ;;
    *'"locked":false'*) systemctl is-active --quiet ttyd || systemctl start ttyd ;;
  esac
  sleep 10
done
EOF
```

**The service:**

```bash
sudo tee /etc/systemd/system/pi-lockdown.service >/dev/null <<'EOF'
[Unit]
Description=Pi terminal lockdown poller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/pi-lockdown-check
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pi-lockdown
systemctl is-active pi-lockdown          # expect: active
```

Because it's `enable`d it also comes back on reboot, alongside `ttyd` and
`cloudflared` — a power-cycle needs no commands, the tunnel reconnects itself.

To lock down: admin panel → Dashboard → **Pi Terminal Lockdown → LOCKDOWN**.
Sessions drop within ~10s. Unlock from the same place — never from the terminal,
since you won't have one. Propagation is typically ~10s but isn't guaranteed
instant (the flag lives in Cloudflare KV, which is eventually consistent).

For an instant, no-waiting kill, stop the tunnel itself at the Pi:
`sudo systemctl stop cloudflared`. That drops all remote access immediately.

---

## If you want to tighten it further

- **A dedicated user.** Make a `console` account without sudo, and have ttyd run
  `login -f console`. A compromised session then can't escalate.
- **Shorten the Access session** to 1 hour, or require re-auth on every visit.
- **Country restriction.** Add a Require block to the Access policy limiting it
  to your country — cheap, and it removes most drive-by traffic.
- **Audit trail.** Zero Trust → Logs → Access shows every login attempt against
  the hostname, allowed and blocked.
