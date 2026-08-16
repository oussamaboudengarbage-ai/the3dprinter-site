function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function authorised(request, env) {
  const token = request.headers.get("X-Admin-Token") || "";
  return Boolean(
    env.ADMIN_ORDERS_TOKEN &&
    token &&
    token === env.ADMIN_ORDERS_TOKEN
  );
}

function configReady(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!authorised(request, env)) {
    return json({ error: "Accès refusé." }, 401);
  }

  if (!configReady(env)) {
    return json({ error: "Base de commandes non configurée." }, 500);
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc&limit=100`,
    {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Accept: "application/json",
      },
    }
  );

  const data = await response.json().catch(() => []);

  if (!response.ok) {
    return json({ error: "Impossible de charger les commandes." }, 502);
  }

  return json({ orders: data });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!authorised(request, env)) {
    return json({ error: "Accès refusé." }, 401);
  }

  if (!configReady(env)) {
    return json({ error: "Base de commandes non configurée." }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }

  const id = String(body.id || "");
  const allowedStatuses = new Set([
    "paid",
    "preparing",
    "ready",
    "shipped",
    "delivered",
    "cancelled",
  ]);

  if (!id || !allowedStatuses.has(body.status)) {
    return json({ error: "Commande ou statut invalide." }, 400);
  }

  const patch = {
    status: body.status,
    tracking_number: String(body.tracking_number || "").trim() || null,
    tracking_url: String(body.tracking_url || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    }
  );

  const data = await response.json().catch(() => []);

  if (!response.ok) {
    return json({ error: "Impossible de modifier la commande." }, 502);
  }

  return json({ order: Array.isArray(data) ? data[0] : data });
}
