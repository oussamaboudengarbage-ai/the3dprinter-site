function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseSignatureHeader(header) {
  const result = {
    timestamp: null,
    signatures: [],
  };

  for (const part of String(header || "").split(",")) {
    const [key, value] = part.split("=", 2);

    if (key === "t") result.timestamp = Number(value);
    if (key === "v1" && value) result.signatures.push(value);
  }

  return result;
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");

  if (left.length !== right.length) return false;

  let diff = 0;

  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return diff === 0;
}

async function sign(secret, payload) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return bytesToHex(signature);
}

async function verifyStripeSignature(rawBody, header, secret) {
  const parsed = parseSignatureHeader(header);

  if (
    !Number.isFinite(parsed.timestamp) ||
    !parsed.signatures.length
  ) {
    return false;
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);

  if (age > 300) {
    return false;
  }

  const expected = await sign(
    secret,
    `${parsed.timestamp}.${rawBody}`
  );

  return parsed.signatures.some((signature) =>
    constantTimeEqual(signature, expected)
  );
}

async function updateOrder(env, orderId, patch) {
  if (!orderId) return;

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        ...patch,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error("Supabase webhook update:", response.status, text);
    throw new Error("Impossible de mettre à jour la commande.");
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (
    !env.STRIPE_WEBHOOK_SECRET ||
    !env.SUPABASE_URL ||
    !env.SUPABASE_SECRET_KEY
  ) {
    return json({ error: "Webhook non configuré." }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  const valid = await verifyStripeSignature(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!valid) {
    return json({ error: "Signature Stripe invalide." }, 400);
  }

  let event;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Événement invalide." }, 400);
  }

  const session = event?.data?.object || {};
  const orderId = session?.metadata?.order_id || "";

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      await updateOrder(env, orderId, {
        status:
          session.payment_status === "paid"
            ? "paid"
            : "payment_pending",
        payment_status:
          session.payment_status === "paid"
            ? "paid"
            : String(session.payment_status || "unpaid"),
        stripe_payment_intent:
          session.payment_intent
            ? String(session.payment_intent)
            : null,
      });
    }

    if (event.type === "checkout.session.async_payment_failed") {
      await updateOrder(env, orderId, {
        status: "payment_failed",
        payment_status: "failed",
      });
    }

    if (event.type === "checkout.session.expired") {
      await updateOrder(env, orderId, {
        status: "cancelled",
        payment_status: "unpaid",
      });
    }
  } catch (error) {
    console.error(error);
    return json({ error: "Mise à jour impossible." }, 500);
  }

  return json({ received: true });
}

export function onRequestGet() {
  return json({ ok: true });
}
