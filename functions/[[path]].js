const AFFILIATE_POSTBACK_TEMPLATE =
  "https://www.hrk4r3do.com/?nid=3455&transaction_id={clickid}&amount={payoutamount}";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    // ---- Debug route: /__debug ----
    if (url.pathname === "/__debug") {
      const hasKV = typeof env.CLICKS !== "undefined";
      const hasApiKey = typeof env.WHOP_API_KEY !== "undefined" && env.WHOP_API_KEY.length > 0;
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
      return new Response(JSON.stringify({ hasKV, kvTest, hasApiKey }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const plan = url.searchParams.get("plan");
    const clickId = url.searchParams.get("clickid") || "";
    const ref = url.searchParams.get("ref") || "";

    if (!plan) {
      return new Response(
        "Missing plan parameter. Example: /?plan=plan_xxxx&clickid=abc123&ref=affiliateusername",
        { status: 400 }
      );
    }

    if (!env.WHOP_API_KEY) {
      return new Response("Missing WHOP_API_KEY environment variable.", { status: 500 });
    }

    // Store the raw click info too, as a backup/local record.
    if (env.CLICKS && clickId) {
      try {
        await env.CLICKS.put(
          clickId,
          JSON.stringify({ plan, ref, created_at: Date.now() }),
          { expirationTtl: 60 * 60 * 24 * 30 }
        );
      } catch (e) {
        // non-fatal
      }
    }

    const whopResponse = await fetch("https://api.whop.com/api/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.WHOP_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: plan,
        affiliate_code: ref || undefined,
        metadata: { click_id: clickId },
      }),
    });

    const whopData = await whopResponse.json().catch(() => null);

    if (!whopResponse.ok || !whopData) {
      return new Response(
        "WHOP API ERROR (status " + whopResponse.status + "):\n" + JSON.stringify(whopData, null, 2),
        { status: 502 }
      );
    }

    const purchaseUrl = whopData.purchase_url;
    if (!purchaseUrl) {
      return new Response(
        "Whop response missing purchase_url:\n" + JSON.stringify(whopData, null, 2),
        { status: 502 }
      );
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: purchaseUrl,
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

export async function onRequestPost({ request }) {
  try {
    const url = new URL(request.url);

    if (url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload) {
      return new Response("Invalid JSON payload", { status: 400 });
    }
    const data = payload.data || payload;
    const clickId = data?.metadata?.click_id;
    const amount = data?.final_amount ?? data?.amount ?? data?.subtotal;

    if (!clickId) {
      return new Response("No click_id in metadata, skipping postback", { status: 200 });
    }

    const postbackUrl = AFFILIATE_POSTBACK_TEMPLATE
      .replace("{clickid}", encodeURIComponent(clickId))
      .replace("{payoutamount}", encodeURIComponent(amount ?? ""));

    // Fire the postback. We still return 200 to Whop either way so it
    // doesn't retry/flag this webhook as failing.
    let postbackStatus = "not attempted";
    try {
      const pbResponse = await fetch(postbackUrl);
      postbackStatus = "fired, status " + pbResponse.status;
    } catch (e) {
      postbackStatus = "postback fetch failed: " + e.message;
    }

    return new Response("OK - " + postbackStatus, { status: 200 });
  } catch (err) {
    return new Response("WEBHOOK ERROR: " + err.message, { status: 500 });
  }
}
