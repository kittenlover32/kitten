export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

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
    // "clickid" here should match whatever macro name the affiliate's
    // tracker (Binom/Keitaro) confirmed they use — swap the param name if theirs differs.
    const trackerClickId = url.searchParams.get("clickid") || null;
    const fbclid = url.searchParams.get("fbclid") || null;
    const ttclid = url.searchParams.get("ttclid") || null;

    if (!plan) {
      return new Response(
        "Missing plan parameter. Example: /?plan=plan_xxxx&ref=affiliatecode&clickid=abc",
        { status: 400 }
      );
    }

    // Optional local backup copy — not required for the tracker's own
    // reporting (their click_id already round-trips via Whop metadata),
    // but useful for your own records/debugging.
    if (env.CLICKS) {
      try {
        await env.CLICKS.put(
          trackerClickId || crypto.randomUUID(),
          JSON.stringify({ plan, ref, trackerClickId, fbclid, ttclid, created_at: Date.now() }),
          { expirationTtl: 60 * 60 * 24 * 30 }
        );
      } catch (e) {
        // Don't block checkout if this fails — logging only.
      }
    }

    // Create the checkout server-side so we can attach metadata.
    const response = await fetch("https://api.whop.com/api/v5/checkout_configurations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHOP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan: { id: plan },
        affiliate_code: ref || null,
        metadata: { ref: ref || null, click_id: trackerClickId },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(`Whop API error: ${errorText}`, { status: 500 });
    }

    const data = await response.json();

    return new Response(null, {
      status: 302,
      headers: {
        Location: data.purchase_url,
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
