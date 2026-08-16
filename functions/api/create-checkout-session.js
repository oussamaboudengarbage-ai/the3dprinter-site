const DEFAULT_PRODUCTS_JSON_URL =
  "https://opensheet.elk.sh/1KHd21NIpAbtMcEUI9NtQ3rvp4pgbZ4xJmQn2-eEI7Ss/1";

const DEFAULT_SHIPPING_CENTS = 600;
const MAX_CART_LINES = 30;
const MAX_QUANTITY = 99;

const ALLOWED_SHIPPING_COUNTRIES = [
  "FR",
  "BE",
  "LU",
  "DE",
  "ES",
  "IT",
  "NL",
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getShippingCents(env) {
  const value = Number.parseInt(env.SHIPPING_CENTS || "", 10);
  return Number.isInteger(value) && value >= 0
    ? value
    : DEFAULT_SHIPPING_CENTS;
}

function parseEuroToCents(value) {
  let cleaned = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!cleaned) return null;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else {
    cleaned = cleaned.replace(",", ".");
  }

  const euros = Number(cleaned);
  if (!Number.isFinite(euros) || euros < 0) return null;

  return Math.round(euros * 100);
}

function normaliseColor(value) {
  const color = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{3,8}$/.test(color) ? color : "";
}

function buildProductIndexes(products) {
  const byId = new Map();
  const byName = new Map();

  for (const product of products) {
    const name = String(product.nom || "").trim();
    const id = String(product.id || name).trim();

    if (!name || !id) continue;

    byId.set(id, product);
    if (!byName.has(name)) byName.set(name, product);
  }

  return { byId, byName };
}

function cleanOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function addStripeLineItem(params, index, item) {
  const prefix = `line_items[${index}]`;

  params.set(`${prefix}[price_data][currency]`, "eur");
  params.set(
    `${prefix}[price_data][product_data][name]`,
    item.displayName.slice(0, 127)
  );
  params.set(
    `${prefix}[price_data][unit_amount]`,
    String(item.unitAmount)
  );
  params.set(`${prefix}[quantity]`, String(item.quantity));
}

async function getCatalogue(env) {
  const productsUrl =
    env.PRODUCTS_JSON_URL || DEFAULT_PRODUCTS_JSON_URL;

  const response = await fetch(productsUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Le catalogue de prix est indisponible.");
  }

  const products = await response.json();

  if (!Array.isArray(products)) {
    throw new Error("Le format du catalogue est invalide.");
  }

  return products;
}

function requireSupabaseConfig(env) {
  return Boolean(
    env.SUPABASE_URL &&
    env.SUPABASE_PUBLISHABLE_KEY &&
    env.SUPABASE_SECRET_KEY
  );
}

async function getAuthenticatedUser(request, env) {
  const header = request.headers.get("Authorization") || "";

  if (!header.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) return null;

  const user = await response.json();

  if (!user || !user.id || !user.email) return null;
  return user;
}

async function supabaseInsertOrder(env, order) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(order),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Supabase insert order:", response.status, text);
    throw new Error("Impossible d’enregistrer la commande.");
  }
}

async function expireStripeSession(env, sessionId) {
  try {
    await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
  } catch (error) {
    console.error("Impossible d’expirer la session Stripe :", error);
  }
}

function createOrderNumber() {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `T3D-${date}-${suffix}`;
}

export async function onRequestGet(context) {
  return jsonResponse({
    shippingCents: getShippingCents(context.env),
    currency: "eur",
    accountRequired: true,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse(
      { error: "Le paiement n’est pas encore configuré." },
      500
    );
  }

  if (!requireSupabaseConfig(env)) {
    return jsonResponse(
      { error: "Le compte client n’est pas encore configuré." },
      500
    );
  }

  const requestOrigin = new URL(request.url).origin;
  const originHeader = request.headers.get("Origin");

  if (originHeader && originHeader !== requestOrigin) {
    return jsonResponse({ error: "Origine de la requête refusée." }, 403);
  }

  const user = await getAuthenticatedUser(request, env);

  if (!user) {
    return jsonResponse(
      { error: "Connectez-vous avant de commander." },
      401
    );
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Corps JSON invalide." }, 400);
  }

  if (
    !payload ||
    !Array.isArray(payload.items) ||
    payload.items.length === 0 ||
    payload.items.length > MAX_CART_LINES
  ) {
    return jsonResponse({ error: "Le panier est vide ou invalide." }, 400);
  }

  let catalogue;

  try {
    catalogue = await getCatalogue(env);
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: "Impossible de vérifier les prix du catalogue." },
      502
    );
  }

  const { byId, byName } = buildProductIndexes(catalogue);
  const verifiedItems = [];

  for (const requestedItem of payload.items) {
    const id = String(requestedItem.id || "").trim();
    const name = String(requestedItem.name || "").trim();
    const quantity = Number.parseInt(requestedItem.quantity, 10);
    const color = normaliseColor(requestedItem.color);

    if (
      (!id && !name) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return jsonResponse(
        { error: "Un article du panier est invalide." },
        400
      );
    }

    const product = byId.get(id) || byName.get(name);

    if (!product) {
      return jsonResponse(
        { error: `Produit introuvable : ${name || id}.` },
        400
      );
    }

    const unitAmount = parseEuroToCents(product.prix);

    if (!Number.isInteger(unitAmount)) {
      return jsonResponse(
        { error: `Le produit « ${product.nom} » est uniquement disponible sur devis.` },
        400
      );
    }

    const allowedColors = String(product.couleurs_codes || "")
      .split("/")
      .map(normaliseColor)
      .filter(Boolean);

    if (color && allowedColors.length && !allowedColors.includes(color)) {
      return jsonResponse(
        { error: `Couleur invalide pour « ${product.nom} ».` },
        400
      );
    }

    const stockRaw = String(product.stock ?? "").trim().toLowerCase();
    const stockNumber = Number.parseInt(stockRaw, 10);

    if (
      Number.isInteger(stockNumber) &&
      stockNumber >= 0 &&
      quantity > stockNumber
    ) {
      return jsonResponse(
        { error: `Stock insuffisant pour « ${product.nom} ».` },
        400
      );
    }

    verifiedItems.push({
      id: String(product.id || product.nom),
      name: String(product.nom).trim(),
      displayName: color
        ? `${String(product.nom).trim()} — ${color}`
        : String(product.nom).trim(),
      unitAmount,
      quantity,
      color,
      image: String(product.image || ""),
    });
  }

  const shippingCents = getShippingCents(env);
  const subtotalCents = verifiedItems.reduce(
    (sum, item) => sum + item.unitAmount * item.quantity,
    0
  );
  const totalCents = subtotalCents + shippingCents;

  const siteOrigin =
    cleanOrigin(env.SITE_URL || "") || requestOrigin;

  const orderId = crypto.randomUUID();
  const orderNumber = createOrderNumber();

  const stripeParams = new URLSearchParams();
  stripeParams.set("mode", "payment");
  stripeParams.set("locale", "fr");
  stripeParams.set("client_reference_id", String(user.id));
  stripeParams.set("customer_email", String(user.email));
  stripeParams.set("billing_address_collection", "required");
  stripeParams.set("phone_number_collection[enabled]", "true");

  stripeParams.set("metadata[order_id]", orderId);
  stripeParams.set("metadata[order_number]", orderNumber);
  stripeParams.set("metadata[user_id]", String(user.id));

  stripeParams.set("payment_intent_data[metadata][order_id]", orderId);
  stripeParams.set(
    "payment_intent_data[metadata][order_number]",
    orderNumber
  );

  stripeParams.set(
    "success_url",
    `${siteOrigin}/compte.html?paiement=succes&commande=${encodeURIComponent(orderNumber)}`
  );
  stripeParams.set(
    "cancel_url",
    `${siteOrigin}/?paiement=annule#catalogue`
  );

  ALLOWED_SHIPPING_COUNTRIES.forEach((country, index) => {
    stripeParams.set(
      `shipping_address_collection[allowed_countries][${index}]`,
      country
    );
  });

  verifiedItems.forEach((item, index) => {
    addStripeLineItem(stripeParams, index, item);
  });

  if (shippingCents > 0) {
    stripeParams.set(
      "shipping_options[0][shipping_rate_data][type]",
      "fixed_amount"
    );
    stripeParams.set(
      "shipping_options[0][shipping_rate_data][fixed_amount][amount]",
      String(shippingCents)
    );
    stripeParams.set(
      "shipping_options[0][shipping_rate_data][fixed_amount][currency]",
      "eur"
    );
    stripeParams.set(
      "shipping_options[0][shipping_rate_data][display_name]",
      "Livraison"
    );
  }

  let stripeResponse;

  try {
    stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: stripeParams.toString(),
      }
    );
  } catch (error) {
    console.error("Erreur réseau Stripe :", error);
    return jsonResponse(
      { error: "Le paiement est temporairement inaccessible." },
      502
    );
  }

  const stripeResult = await stripeResponse.json();

  if (!stripeResponse.ok || !stripeResult.url || !stripeResult.id) {
    console.error("Erreur Stripe :", stripeResult);
    return jsonResponse(
      {
        error:
          stripeResult?.error?.message ||
          "Impossible de créer la page de paiement.",
      },
      502
    );
  }

  try {
    await supabaseInsertOrder(env, {
      id: orderId,
      order_number: orderNumber,
      user_id: String(user.id),
      email: String(user.email),
      status: "payment_pending",
      payment_status: "unpaid",
      amount_subtotal: subtotalCents,
      shipping_cents: shippingCents,
      amount_total: totalCents,
      currency: "eur",
      items: verifiedItems.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        color: item.color,
        unit_amount: item.unitAmount,
        image: item.image,
      })),
      stripe_session_id: stripeResult.id,
    });
  } catch (error) {
    await expireStripeSession(env, stripeResult.id);
    return jsonResponse(
      { error: "La commande n’a pas pu être enregistrée. Réessayez." },
      502
    );
  }

  return jsonResponse({
    url: stripeResult.url,
    orderNumber,
  });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, OPTIONS",
    },
  });
}
