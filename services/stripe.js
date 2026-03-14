import Stripe from "stripe";
import { getEnv, requireEnv } from "./env.js";

let stripeInstance = null;

function getStripe() {
  if (!stripeInstance) {
    const secretKey = requireEnv("STRIPE_SECRET_KEY");
    stripeInstance = new Stripe(secretKey);
  }
  return stripeInstance;
}

/**
 * Creates a Stripe Checkout Session for the given cart items.
 *
 * @param {Array<{name, product_key, color, size, quantity, price, image_url, slug}>} items
 * @param {{ successUrl: string, cancelUrl: string }} urls
 * @returns {Promise<{id: string, url: string}>}
 */
export async function createCheckoutSession(items, { successUrl, cancelUrl }) {
  const stripe = getStripe();

  const lineItems = items.map((item) => ({
    price_data: {
      currency: "eur",
      product_data: {
        name: item.name || "Prenda personalizada",
        description: [item.size, item.color].filter(Boolean).join(" · ") || undefined,
        metadata: {
          product_key: item.product_key,
          color: item.color || "",
          size: item.size || "",
          image_url: item.image_url || "",
          slug: item.slug || "",
          layout: item.layout ? JSON.stringify(item.layout) : "",
        },
      },
      unit_amount: Math.round((item.price || 0) * 100),
    },
    quantity: item.quantity || 1,
  }));

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    // Dynamic payment methods: cards, Apple Pay, Google Pay, Link, etc.
    // Enabled wallets are configured in Stripe Dashboard → Settings → Payment methods
    payment_method_types: undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
    shipping_address_collection: {
      allowed_countries: [
        "ES", "FR", "DE", "IT", "PT", "NL", "BE", "AT", "IE",
        "GB", "US", "CA", "MX",
      ],
    },
    phone_number_collection: { enabled: true },
    metadata: {
      source: "genmytee_web",
      item_count: String(items.length),
    },
  });

  return { id: session.id, url: session.url };
}

/**
 * Verifies a Stripe webhook signature and returns the parsed event.
 *
 * @param {Buffer} rawBody
 * @param {string} signature
 * @returns {Stripe.Event}
 */
export function verifyWebhookSignature(rawBody, signature) {
  const stripe = getStripe();
  const secret = requireEnv("STRIPE_WEBHOOK_SECRET");
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Extracts order data from a completed checkout session.
 *
 * @param {Stripe.Checkout.Session} session
 * @returns {Promise<{order_id, external_id, recipient, items}>}
 */
export async function extractOrderFromSession(session) {
  const stripe = getStripe();

  // Fetch line items with product data
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    expand: ["data.price.product"],
  });

  const shipping = session.shipping_details || session.customer_details || {};
  const address = shipping.address || {};

  const recipient = {
    name: shipping.name || session.customer_details?.name || "Customer",
    address1: address.line1 || "",
    address2: address.line2 || undefined,
    city: address.city || "",
    country_code: address.country || "",
    state_code: address.state || "",
    zip: address.postal_code || "",
    email: session.customer_details?.email || undefined,
    phone: session.customer_details?.phone || undefined,
  };

  const items = lineItems.data.map((li) => {
    const product = li.price?.product;
    const meta = (typeof product === "object" && product?.metadata) || {};
    let layout;
    if (meta.layout) {
      try { layout = JSON.parse(meta.layout); } catch { /* ignore corrupted layout */ }
    }
    return {
      product_key: meta.product_key || "all-over-print-mens-athletic-t-shirt",
      color: meta.color || undefined,
      size: meta.size || undefined,
      quantity: li.quantity || 1,
      image_url: meta.image_url || undefined,
      layout,
    };
  });

  // Printful external_id has a 64-char limit; session.id can exceed that.
  // Use payment_intent (shorter, ~27 chars) when available, fall back to truncated session id.
  const shortId = session.payment_intent || session.id.slice(-32);
  const externalId = `gmt-${shortId}`;

  return {
    order_id: session.id,
    external_id: externalId,
    recipient,
    items,
  };
}

/**
 * Retrieves a Stripe Checkout Session for order status lookup.
 * Includes line items and shipping details for the checkout success page.
 *
 * @param {string} sessionId
 * @returns {Promise<{session_id, payment_status, email, fulfillment_status, items, shipping, amount_total, currency}>}
 */
export async function retrieveSession(sessionId) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  // Fetch line items with product metadata
  let items = [];
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
      expand: ["data.price.product"],
    });
    items = lineItems.data.map((li) => {
      const product = li.price?.product;
      const meta = (typeof product === "object" && product?.metadata) || {};
      return {
        name: (typeof product === "object" && product?.name) || li.description || "Prenda personalizada",
        size: meta.size || null,
        color: meta.color || null,
        quantity: li.quantity || 1,
        amount: li.amount_total ? li.amount_total / 100 : 0,
        image_url: meta.image_url || null,
        product_key: meta.product_key || null,
      };
    });
  } catch {
    // Line items fetch is best-effort
  }

  // Extract shipping address
  const shipping = session.shipping_details || null;
  const shippingInfo = shipping ? {
    name: shipping.name || null,
    city: shipping.address?.city || null,
    country: shipping.address?.country || null,
    postal_code: shipping.address?.postal_code || null,
  } : null;

  return {
    session_id: session.id,
    payment_status: session.payment_status,
    email: session.customer_details?.email || null,
    fulfillment_status: session.metadata?.fulfillment_status || "processing",
    items,
    shipping: shippingInfo,
    amount_total: session.amount_total ? session.amount_total / 100 : null,
    currency: session.currency || "eur",
  };
}

export function _resetStripeForTests() {
  stripeInstance = null;
}
