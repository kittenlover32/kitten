export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    // ---- Debug route: /__debug ----
    if (url.pathname === "/__debug") {
      const hasKV = typeof env.CLICKS !== "undefined";
      let kvTest = "not attempted";
      if (hasKV) {
        try {
          await env.CLICKS.put("__debug_test", "ok", { expirationTtl: 60 });
          const v = await env.CLICKS.get("__debug_test");
          kvTest = v === "ok" ? "KV WRITE+READ OK" : "KV write ok but read mismatch: " + v;
        } catch (e) {
          kvTest = "KV ERROR: " + e.message;
        }
      }
      return new Response(JSON.stringify({ hasKV, kvTest }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const plan = url.searchParams.get("plan");
    const ref = url.searchParams.get("ref") || "";
    const fbclid = url.searchParams.get("fbclid") || null;
    const ttclid = url.searchParams.get("ttclid") || null;

    if (!plan) {
      return new Response("Missing plan parameter. Example: /?plan=plan_xxxx&ref=affiliatecode", {
        status: 400,
      });
    }
    if (env.CLICKS) {
      try {
        const clickId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        await env.CLICKS.put(
          clickId,
          JSON.stringify({ plan, ref, fbclid, ttclid, created_at: Date.now() }),
          { expirationTtl: 60 * 60 * 24 * 30 }
        );
      } catch (e) {
        // Don't block the redirect if KV write fails — logging only.
      }
    }

    let whopUrl = `https://whop.com/checkout/${encodeURIComponent(plan)}/`;
    if (ref) {
      whopUrl += `?a=${encodeURIComponent(ref)}`;
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: whopUrl,
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response("FUNCTION ERROR: " + err.message + "\n" + (err.stack || ""), {
      status: 500,
    });
  }
}
