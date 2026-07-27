const DEFAULT_PRODUCTS_JSON_URL =
  "https://opensheet.elk.sh/1KHd21NIpAbtMcEUI9NtQ3rvp4pgbZ4xJmQn2-eEI7Ss/1";

const DEFAULT_SHIPPING_CENTS = 499;
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

function parseStockLimit(value) {
  const normalized = String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    !normalized ||
    ["illimite", "unlimited", "in", "oui", "yes"].includes(normalized)
  ) {
    return null;
  }

  if (["out", "rupture", "epuise", "non"].includes(normalized)) {
    return 0;
  }

  const quantity = Number.parseInt(normalized, 10);
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : null;
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
    headers: {
      Accept: "application/json",
    },
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

export async function onRequestGet(context) {
  return jsonResponse({
    shippingCents: getShippingCents(context.env),
    currency: "eur",
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse(
      { error: "La clé Stripe n'est pas configurée sur Cloudflare." },
      500
    );
  }

  const requestOrigin = new URL(request.url).origin;
  const originHeader = request.headers.get("Origin");

  if (originHeader && originHeader !== requestOrigin) {
    return jsonResponse({ error: "Origine de la requête refusée." }, 403);
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
  const requestedQuantityByProduct = new Map();

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

    const stockLimit = parseStockLimit(product.stock);
    const productKey = String(product.id || product.nom).trim();
    const requestedTotal =
      (requestedQuantityByProduct.get(productKey) || 0) + quantity;

    if (stockLimit !== null && requestedTotal > stockLimit) {
      const stockMessage =
        stockLimit <= 0
          ? `Le produit « ${product.nom} » est en rupture de stock.`
          : `Il ne reste que ${stockLimit} exemplaire(s) de « ${product.nom} ».`;

      return jsonResponse({ error: stockMessage }, 400);
    }

    requestedQuantityByProduct.set(productKey, requestedTotal);

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

    verifiedItems.push({
      displayName: color
        ? `${String(product.nom).trim()} — ${color}`
        : String(product.nom).trim(),
      unitAmount,
      quantity,
    });
  }

  const siteOrigin =
    cleanOrigin(env.SITE_URL || "") || requestOrigin;

  const stripeParams = new URLSearchParams();
  stripeParams.set("mode", "payment");
  stripeParams.set("locale", "fr");
  stripeParams.set("billing_address_collection", "required");
  stripeParams.set("phone_number_collection[enabled]", "true");
  stripeParams.set(
    "success_url",
    `${siteOrigin}/merci.html?session_id={CHECKOUT_SESSION_ID}`
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

  const shippingCents = getShippingCents(env);

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
      { error: "Stripe est temporairement inaccessible." },
      502
    );
  }

  const stripeResult = await stripeResponse.json();

  if (!stripeResponse.ok || !stripeResult.url) {
    console.error("Erreur Stripe :", stripeResult);
    return jsonResponse(
      {
        error:
          stripeResult?.error?.message ||
          "Stripe n'a pas pu créer la page de paiement.",
      },
      502
    );
  }

  return jsonResponse({ url: stripeResult.url });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, OPTIONS",
    },
  });
}
