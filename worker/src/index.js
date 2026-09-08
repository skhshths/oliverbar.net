const ADMIN_TRIGGER_FIXED = "ADMIN"; // permanently fixed, cannot be changed via the admin UI or the API

const DEFAULT_CONFIG = {
  admin:       { label: "Admin",       trigger: ADMIN_TRIGGER_FIXED, enabled: true },
  interactive: { label: "Interactive", trigger: "interactive",       enabled: true },
  portfolio:   { label: "Portfolio",   trigger: "portfolio",         enabled: true },
  chat:        { label: "Chat",        trigger: "chat",              enabled: true },
  custom: [],
};

const MAX_CHAT_MESSAGES = 200;
const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Edit-Key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ---------- Box layout (the "interactive" page's canvas) ----------
    if (url.pathname === "/api/layout" && request.method === "GET") {
      const stored = await env.LAYOUT_KV.get("layout");
      return new Response(stored || "[]", {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (url.pathname === "/api/layout" && request.method === "POST") {
      const editKey = request.headers.get("X-Edit-Key") || "";
      if (editKey !== env.EDIT_PASSWORD) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      let body;
      try {
        body = await request.text();
        JSON.parse(body);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      await env.LAYOUT_KV.put("layout", body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ---------- Site config: fixed pages + custom redirects ----------
    if (url.pathname === "/api/config" && request.method === "GET") {
      const stored = await env.LAYOUT_KV.get("site_config");
      return new Response(stored || JSON.stringify(DEFAULT_CONFIG), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (url.pathname === "/api/config" && request.method === "POST") {
      const editKey = request.headers.get("X-Edit-Key") || "";
      if (editKey !== env.EDIT_PASSWORD) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      let body, parsed;
      try {
        body = await request.text();
        parsed = JSON.parse(body);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const requiredKeys = ["admin", "interactive", "portfolio", "chat"];
      const fixedValid = requiredKeys.every(function (k) {
        return (
          parsed[k] &&
          typeof parsed[k].trigger === "string" &&
          parsed[k].trigger.length > 0 &&
          typeof parsed[k].enabled === "boolean"
        );
      });
      if (!fixedValid) {
        return new Response(JSON.stringify({ error: "Malformed config" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      if (parsed.custom !== undefined) {
        if (!Array.isArray(parsed.custom)) {
          return new Response(JSON.stringify({ error: "custom must be an array" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
        const customValid = parsed.custom.every(function (item) {
          return (
            item &&
            typeof item.id === "string" && item.id.length > 0 &&
            typeof item.trigger === "string" && item.trigger.length > 0 &&
            typeof item.destination === "string" && item.destination.length > 0 &&
            typeof item.enabled === "boolean"
          );
        });
        if (!customValid) {
          return new Response(JSON.stringify({ error: "Malformed custom entry" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      } else {
        parsed.custom = [];
      }

      // Hard safety rules, enforced here regardless of what the client
      // sent: admin can never be disabled, and its trigger word can
      // never be anything other than the fixed value. This is what
      // actually guarantees it — the admin UI also locks both of
      // these visually, but this is the real backstop.
      parsed.admin.enabled = true;
      parsed.admin.trigger = ADMIN_TRIGGER_FIXED;

      await env.LAYOUT_KV.put("site_config", JSON.stringify(parsed));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ---------- Global chat ----------
    // No password on this one by design — it's meant to be open to
    // anyone who reaches the chat page. See the README for the real
    // implications of that (no rate limiting, no moderation).
    if (url.pathname === "/api/chat" && request.method === "GET") {
      const stored = await env.LAYOUT_KV.get("chat_messages");
      return new Response(stored || "[]", {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      let body, parsed;
      try {
        body = await request.text();
        parsed = JSON.parse(body);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, MAX_NAME_LENGTH) : "";
      const text = typeof parsed.text === "string" ? parsed.text.trim().slice(0, MAX_MESSAGE_LENGTH) : "";

      if (!name || !text) {
        return new Response(JSON.stringify({ error: "name and text are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const stored = await env.LAYOUT_KV.get("chat_messages");
      let messages = [];
      try { messages = stored ? JSON.parse(stored) : []; } catch (e) { messages = []; }

      messages.push({ name: name, text: text, ts: Date.now() });
      if (messages.length > MAX_CHAT_MESSAGES) {
        messages = messages.slice(messages.length - MAX_CHAT_MESSAGES);
      }

      await env.LAYOUT_KV.put("chat_messages", JSON.stringify(messages));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ---------- Custom pages (self-serve HTML, no Cloudflare Pages deploy needed) ----------
    if (url.pathname === "/api/pages" && request.method === "GET") {
      const stored = await env.LAYOUT_KV.get("custom_pages");
      return new Response(stored || "[]", {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (url.pathname === "/api/pages" && request.method === "POST") {
      const editKey = request.headers.get("X-Edit-Key") || "";
      if (editKey !== env.EDIT_PASSWORD) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      let body, parsed;
      try {
        body = await request.text();
        parsed = JSON.parse(body);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      if (!Array.isArray(parsed)) {
        return new Response(JSON.stringify({ error: "Expected an array of pages" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      // Slug now allows nested paths, e.g. "test" or "test/about-us" —
      // one or more lowercase/number/dash segments separated by slashes,
      // no leading/trailing/double slashes.
      const SLUG_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
      const badEntry = parsed.find(function (p) {
        return !(p && typeof p.slug === "string" && SLUG_RE.test(p.slug) && typeof p.html === "string" && p.html.length > 0);
      });
      if (badEntry) {
        return new Response(JSON.stringify({
          error: "Each page needs a lowercase path using letters, numbers, dashes and slashes, plus an html string",
          badSlug: badEntry && typeof badEntry.slug === "string" ? badEntry.slug : "(missing)"
        }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      await env.LAYOUT_KV.put("custom_pages", JSON.stringify(parsed));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ---------- Clear chat (admin-only) ----------
    if (url.pathname === "/api/chat/clear" && request.method === "POST") {
      const editKey = request.headers.get("X-Edit-Key") || "";
      if (editKey !== env.EDIT_PASSWORD) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      await env.LAYOUT_KV.put("chat_messages", "[]");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Serving a stored custom page directly, e.g. GET /page/my-slug
    if (url.pathname.startsWith("/page/") && request.method === "GET") {
      const slug = url.pathname.slice("/page/".length);
      const stored = await env.LAYOUT_KV.get("custom_pages");
      let pages = [];
      try { pages = stored ? JSON.parse(stored) : []; } catch (e) { pages = []; }
      const page = pages.find(function (p) { return p.slug === slug; });
      if (!page) {
        return new Response("Not found", { status: 404, headers: corsHeaders });
      }
      return new Response(page.html, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};
