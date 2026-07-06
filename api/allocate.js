export default async function handler(request, env) {
  try {
    const url = new URL(request.url);
    const tier = url.searchParams.get("tier"); // tier_1..tier_4
    if (!tier) return new Response("Missing tier", { status: 400 });

    const KV = env.CLICKS;
    if (!KV) return new Response("Missing KV binding: CLICKS", { status: 500 });

    const MAX_ORDERS_PER_ACCOUNT_PER_DAY = 15;
    const ACCOUNT_COUNT = 8;

    const now = new Date();
    const dayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;

    // Rotate starting point so it doesn't always start at 0
    const rrKey = `alloc:rr:${dayKey}`;
    const rrRaw = await KV.get(rrKey);
    const rr = rrRaw ? parseInt(rrRaw, 10) : 0;
    const start = Number.isFinite(rr) ? (rr % ACCOUNT_COUNT) : 0;

    for (let offset = 0; offset < ACCOUNT_COUNT; offset++) {
      const accountIndex = (start + offset) % ACCOUNT_COUNT;
      const counterKey = `alloc:count:${dayKey}:acct:${accountIndex}`;

      const rawCount = await KV.get(counterKey);
      const count = rawCount ? parseInt(rawCount, 10) : 0;

      if (count < MAX_ORDERS_PER_ACCOUNT_PER_DAY) {
        // Best-effort increment (KV)
        await KV.put(counterKey, String(count + 1));

        // Move rr forward
        await KV.put(rrKey, String(accountIndex + 1));

        return new Response(JSON.stringify({ accountIndex, dayKey, tier }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify({ error: "Daily cap reached" }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response("Allocator error: " + e.message, { status: 500 });
  }
}
