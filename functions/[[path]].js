export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    const plan = url.searchParams.get("plan");
    const ref = url.searchParams.get("ref") || "";
    const fbclid = url.searchParams.get("fbclid") || null;
    const ttclid = url.searchParams.get("ttclid") || null;

    // Debug page — visit yoursite.pages.dev/__debug to check things
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
      return new Response(
        JSON.stringify({ hasKV, kvTest, plan, ref, fbclid, ttclid }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (!plan) {
      return new Response("Missing plan parameter. Try /?plan=YOUR_PLAN_ID&ref=affiliatecode", {
        status: 400,
      });
    }

    if (!env.CLICKS) {
      return new Response(
        "KV binding 'CLICKS' is not available in this environment. Go to Pages > Settings > Functions > KV namespace bindings and add it for Production AND Preview.",
        { status: 500 }
      );
    }

    const clickId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    await env.CLICKS.put(
      clickId,
      JSON.stringify({ ref, fbclid, ttclid, plan, created_at: Date.now() }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );

    const whopUrl =
      `https://whop.com/checkout/${encodeURIComponent(plan)}/` +
      `?a=${encodeURIComponent(ref)}` +
      `&click_id=${clickId}`;

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