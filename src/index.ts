/**
 * Stripe Complete MCP Server
 * Complete wrapper for the Stripe payments API.
 * Manages payments, subscriptions, customers, invoices, and revenue reporting.
 */

const express = require("express");
const fetch = require("node-fetch");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const PORT = process.env.PORT || 8080;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_BASE = "https://api.stripe.com/v1";

// ---------------------------------------------------------------------------
// Stripe HTTP helper
// ---------------------------------------------------------------------------

function stripeAuth() {
  const key = STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY environment variable is not set");
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

async function stripeGet(path, params = {}) {
  const url = new URL(STRIPE_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { Authorization: stripeAuth() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

async function stripePost(path, body = {}) {
  const params = new URLSearchParams();
  function flatten(obj, prefix = "") {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      const key = prefix ? `${prefix}[${k}]` : k;
      if (typeof v === "object" && !Array.isArray(v)) {
        flatten(v, key);
      } else {
        params.append(key, String(v));
      }
    }
  }
  flatten(body);
  const res = await fetch(STRIPE_BASE + path, {
    method: "POST",
    headers: {
      Authorization: stripeAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

async function stripeDelete(path) {
  const res = await fetch(STRIPE_BASE + path, {
    method: "DELETE",
    headers: { Authorization: stripeAuth() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "stripe-complete",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// 1. Payment Intents
// ---------------------------------------------------------------------------

server.tool(
  "create_payment_intent",
  "Create a new Stripe PaymentIntent to collect a payment. Example: create a $50 USD payment intent for customer cus_abc123 with card payment method.",
  {
    amount: z.number().int().positive().describe("Amount in smallest currency unit (e.g. cents for USD). Example: 5000 = $50.00"),
    currency: z.string().min(3).max(3).describe("Three-letter ISO currency code. Example: 'usd', 'eur', 'gbp'"),
    customer: z.string().optional().describe("Stripe customer ID to attach the payment to. Example: 'cus_abc123'"),
    description: z.string().optional().describe("Internal description of what this payment is for"),
    payment_method_types: z.array(z.string()).optional().describe("Payment methods to accept. Defaults to ['card']"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata to attach. Example: {order_id: 'ord_123'}"),
  },
  async ({ amount, currency, customer, description, payment_method_types, metadata }) => {
    const body = { amount, currency };
    if (customer) body.customer = customer;
    if (description) body.description = description;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    if (payment_method_types) {
      payment_method_types.forEach((pm, i) => { body[`payment_method_types[${i}]`] = pm; });
    }
    const pi = await stripePost("/payment_intents", body);
    return { content: [{ type: "text", text: JSON.stringify(pi, null, 2) }] };
  }
);

server.tool(
  "confirm_payment_intent",
  "Confirm a PaymentIntent to capture funds. Example: confirm pi_abc123 with payment method pm_card_visa.",
  {
    payment_intent_id: z.string().describe("PaymentIntent ID. Example: 'pi_3OkL2M2eZvKYlo2C1234abcd'"),
    payment_method: z.string().optional().describe("Payment method ID to use. Example: 'pm_card_visa'"),
    return_url: z.string().optional().describe("URL to redirect after 3DS authentication"),
  },
  async ({ payment_intent_id, payment_method, return_url }) => {
    const body = {};
    if (payment_method) body.payment_method = payment_method;
    if (return_url) body.return_url = return_url;
    const pi = await stripePost(`/payment_intents/${payment_intent_id}/confirm`, body);
    return { content: [{ type: "text", text: JSON.stringify(pi, null, 2) }] };
  }
);

server.tool(
  "cancel_payment_intent",
  "Cancel a PaymentIntent that has not yet been captured. Example: cancel pi_abc123 because customer changed their mind.",
  {
    payment_intent_id: z.string().describe("PaymentIntent ID to cancel. Example: 'pi_3OkL2M2eZvKYlo2C1234abcd'"),
    cancellation_reason: z.enum(["duplicate", "fraudulent", "requested_by_customer", "abandoned"]).optional()
      .describe("Why the payment is being cancelled"),
  },
  async ({ payment_intent_id, cancellation_reason }) => {
    const body = {};
    if (cancellation_reason) body.cancellation_reason = cancellation_reason;
    const pi = await stripePost(`/payment_intents/${payment_intent_id}/cancel`, body);
    return { content: [{ type: "text", text: JSON.stringify(pi, null, 2) }] };
  }
);

server.tool(
  "list_payment_intents",
  "List recent PaymentIntents, optionally filtered by customer. Example: list the last 20 payment intents for customer cus_abc123.",
  {
    customer: z.string().optional().describe("Filter by customer ID. Example: 'cus_abc123'"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results (1-100). Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination — ID of last item from previous page"),
  },
  async ({ customer, limit, starting_after }) => {
    const params = { limit };
    if (customer) params.customer = customer;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/payment_intents", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// 2. Customer Management
// ---------------------------------------------------------------------------

server.tool(
  "create_customer",
  "Create a new Stripe customer record. Example: create customer John Doe with email john@example.com and phone +1555123456.",
  {
    email: z.string().email().optional().describe("Customer email address. Example: 'john@example.com'"),
    name: z.string().optional().describe("Customer full name. Example: 'John Doe'"),
    phone: z.string().optional().describe("Customer phone number. Example: '+15551234567'"),
    description: z.string().optional().describe("Internal description/notes about the customer"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata. Example: {plan: 'enterprise', source: 'website'}"),
  },
  async ({ email, name, phone, description, metadata }) => {
    const body = {};
    if (email) body.email = email;
    if (name) body.name = name;
    if (phone) body.phone = phone;
    if (description) body.description = description;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    const customer = await stripePost("/customers", body);
    return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
  }
);

server.tool(
  "get_customer",
  "Retrieve a single Stripe customer by ID. Example: get details for customer cus_abc123 including their subscriptions.",
  {
    customer_id: z.string().describe("Stripe customer ID. Example: 'cus_NffrFeUfNV2Hib'"),
  },
  async ({ customer_id }) => {
    const customer = await stripeGet(`/customers/${customer_id}`);
    return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
  }
);

server.tool(
  "update_customer",
  "Update a Stripe customer's details. Example: update customer cus_abc123 to change their email or add metadata.",
  {
    customer_id: z.string().describe("Stripe customer ID. Example: 'cus_NffrFeUfNV2Hib'"),
    email: z.string().email().optional().describe("New email address"),
    name: z.string().optional().describe("New full name"),
    phone: z.string().optional().describe("New phone number"),
    description: z.string().optional().describe("Updated internal description"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata to set/update"),
  },
  async ({ customer_id, email, name, phone, description, metadata }) => {
    const body = {};
    if (email) body.email = email;
    if (name) body.name = name;
    if (phone) body.phone = phone;
    if (description) body.description = description;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    const customer = await stripePost(`/customers/${customer_id}`, body);
    return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
  }
);

server.tool(
  "list_customers",
  "List Stripe customers, optionally filtered by email. Example: find all customers with email containing @acme.com.",
  {
    email: z.string().optional().describe("Filter by exact email address"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results (1-100). Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ email, limit, starting_after }) => {
    const params = { limit };
    if (email) params.email = email;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/customers", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "delete_customer",
  "Permanently delete a Stripe customer and cancel all their subscriptions. Example: delete test customer cus_test123.",
  {
    customer_id: z.string().describe("Stripe customer ID to delete. Example: 'cus_NffrFeUfNV2Hib'"),
  },
  async ({ customer_id }) => {
    const result = await stripeDelete(`/customers/${customer_id}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// 3. Subscriptions
// ---------------------------------------------------------------------------

server.tool(
  "create_subscription",
  "Create a new subscription for a customer. Example: subscribe customer cus_abc123 to price price_monthly_pro at $29/month.",
  {
    customer: z.string().describe("Stripe customer ID. Example: 'cus_NffrFeUfNV2Hib'"),
    price_id: z.string().describe("Price ID to subscribe to. Example: 'price_1OkL2M2eZvKYlo2Cabc123'"),
    quantity: z.number().int().positive().default(1).describe("Number of units. Default: 1"),
    trial_period_days: z.number().int().min(0).optional().describe("Days of free trial before billing starts"),
    coupon: z.string().optional().describe("Coupon ID to apply a discount"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  },
  async ({ customer, price_id, quantity, trial_period_days, coupon, metadata }) => {
    const body = {
      customer,
      "items[0][price]": price_id,
      "items[0][quantity]": quantity,
    };
    if (trial_period_days !== undefined) body.trial_period_days = trial_period_days;
    if (coupon) body.coupon = coupon;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    const sub = await stripePost("/subscriptions", body);
    return { content: [{ type: "text", text: JSON.stringify(sub, null, 2) }] };
  }
);

server.tool(
  "update_subscription",
  "Update a subscription — change plan, quantity, or apply discounts. Example: upgrade sub_abc123 to a higher-tier price.",
  {
    subscription_id: z.string().describe("Subscription ID. Example: 'sub_1OkL2M2eZvKYlo2C1234'"),
    price_id: z.string().optional().describe("New price ID to switch to"),
    quantity: z.number().int().positive().optional().describe("New quantity"),
    coupon: z.string().optional().describe("Apply a coupon discount"),
    cancel_at_period_end: z.boolean().optional().describe("Set true to cancel at end of current billing period"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata to update"),
  },
  async ({ subscription_id, price_id, quantity, coupon, cancel_at_period_end, metadata }) => {
    // First get the subscription to find the item ID if we need to change the price
    const body = {};
    if (price_id || quantity !== undefined) {
      const existing = await stripeGet(`/subscriptions/${subscription_id}`);
      const itemId = existing.items?.data?.[0]?.id;
      if (itemId) {
        if (price_id) body[`items[0][id]`] = itemId, body[`items[0][price]`] = price_id;
        if (quantity !== undefined) {
          body[`items[0][id]`] = itemId;
          body[`items[0][quantity]`] = quantity;
        }
      }
    }
    if (coupon) body.coupon = coupon;
    if (cancel_at_period_end !== undefined) body.cancel_at_period_end = cancel_at_period_end;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    const sub = await stripePost(`/subscriptions/${subscription_id}`, body);
    return { content: [{ type: "text", text: JSON.stringify(sub, null, 2) }] };
  }
);

server.tool(
  "cancel_subscription",
  "Cancel a subscription immediately or at the end of the billing period. Example: cancel sub_abc123 at period end.",
  {
    subscription_id: z.string().describe("Subscription ID to cancel. Example: 'sub_1OkL2M2eZvKYlo2C1234'"),
    at_period_end: z.boolean().default(false).describe("If true, cancel at end of billing period. If false, cancel immediately. Default: false"),
  },
  async ({ subscription_id, at_period_end }) => {
    let result;
    if (at_period_end) {
      result = await stripePost(`/subscriptions/${subscription_id}`, { cancel_at_period_end: true });
    } else {
      result = await stripeDelete(`/subscriptions/${subscription_id}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_subscriptions",
  "List subscriptions, optionally filtered by customer or status. Example: list all active subscriptions for customer cus_abc123.",
  {
    customer: z.string().optional().describe("Filter by customer ID"),
    status: z.enum(["active", "past_due", "unpaid", "canceled", "incomplete", "trialing", "all"]).default("active")
      .describe("Filter by subscription status. Default: active"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results. Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ customer, status, limit, starting_after }) => {
    const params = { limit };
    if (customer) params.customer = customer;
    if (status && status !== "all") params.status = status;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/subscriptions", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// 4. Invoices
// ---------------------------------------------------------------------------

server.tool(
  "create_invoice",
  "Create a draft invoice for a customer. Example: create an invoice for customer cus_abc123 for consulting services.",
  {
    customer: z.string().describe("Stripe customer ID. Example: 'cus_NffrFeUfNV2Hib'"),
    description: z.string().optional().describe("Invoice description visible to the customer"),
    auto_advance: z.boolean().default(true).describe("Automatically finalize and attempt payment. Default: true"),
    collection_method: z.enum(["charge_automatically", "send_invoice"]).default("send_invoice")
      .describe("How to collect payment. Default: send_invoice"),
    days_until_due: z.number().int().min(1).optional().describe("Days until invoice is due (for send_invoice method). Example: 30"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  },
  async ({ customer, description, auto_advance, collection_method, days_until_due, metadata }) => {
    const body = { customer, auto_advance, collection_method };
    if (description) body.description = description;
    if (days_until_due) body.days_until_due = days_until_due;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    const invoice = await stripePost("/invoices", body);
    return { content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }] };
  }
);

server.tool(
  "send_invoice",
  "Send a finalized invoice to the customer via email. Example: send invoice inv_abc123 to the customer.",
  {
    invoice_id: z.string().describe("Invoice ID to send. Example: 'in_1OkL2M2eZvKYlo2C1234'"),
  },
  async ({ invoice_id }) => {
    const result = await stripePost(`/invoices/${invoice_id}/send`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_invoices",
  "List invoices, optionally filtered by customer or status. Example: list all unpaid invoices for the past 30 days.",
  {
    customer: z.string().optional().describe("Filter by customer ID"),
    status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).optional().describe("Filter by invoice status"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results. Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ customer, status, limit, starting_after }) => {
    const params = { limit };
    if (customer) params.customer = customer;
    if (status) params.status = status;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/invoices", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_invoice",
  "Retrieve a single invoice by ID with all line items and payment details. Example: get full details for invoice in_abc123.",
  {
    invoice_id: z.string().describe("Invoice ID. Example: 'in_1OkL2M2eZvKYlo2C1234'"),
  },
  async ({ invoice_id }) => {
    const invoice = await stripeGet(`/invoices/${invoice_id}`);
    return { content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }] };
  }
);

server.tool(
  "pay_invoice",
  "Attempt to pay an open invoice immediately. Example: manually trigger payment for overdue invoice in_abc123.",
  {
    invoice_id: z.string().describe("Invoice ID to pay. Example: 'in_1OkL2M2eZvKYlo2C1234'"),
    payment_method: z.string().optional().describe("Payment method ID to use. Uses customer default if not provided"),
  },
  async ({ invoice_id, payment_method }) => {
    const body = {};
    if (payment_method) body.payment_method = payment_method;
    const result = await stripePost(`/invoices/${invoice_id}/pay`, body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// 5. Coupons & Discounts
// ---------------------------------------------------------------------------

server.tool(
  "create_coupon",
  "Create a discount coupon. Example: create SUMMER25 coupon for 25% off, valid forever, max 100 redemptions.",
  {
    name: z.string().describe("Human-readable coupon name. Example: 'SUMMER25'"),
    duration: z.enum(["once", "repeating", "forever"]).describe("How long the discount applies: once (one payment), repeating (N months), forever"),
    percent_off: z.number().min(0.01).max(100).optional().describe("Percentage discount. Example: 25 for 25% off. Cannot use with amount_off"),
    amount_off: z.number().int().positive().optional().describe("Fixed discount in smallest currency unit. Example: 500 = $5.00. Cannot use with percent_off"),
    currency: z.string().min(3).max(3).optional().describe("Required if amount_off is set. Example: 'usd'"),
    duration_in_months: z.number().int().positive().optional().describe("Required if duration=repeating. Number of months discount applies"),
    max_redemptions: z.number().int().positive().optional().describe("Limit total redemptions. Example: 100"),
    redeem_by: z.number().int().optional().describe("Unix timestamp expiry. Example: 1735689600 for Jan 1 2025"),
  },
  async ({ name, duration, percent_off, amount_off, currency, duration_in_months, max_redemptions, redeem_by }) => {
    if (!percent_off && !amount_off) throw new Error("Either percent_off or amount_off is required");
    const body = { name, duration };
    if (percent_off) body.percent_off = percent_off;
    if (amount_off) { body.amount_off = amount_off; body.currency = currency || "usd"; }
    if (duration_in_months) body.duration_in_months = duration_in_months;
    if (max_redemptions) body.max_redemptions = max_redemptions;
    if (redeem_by) body.redeem_by = redeem_by;
    const coupon = await stripePost("/coupons", body);
    return { content: [{ type: "text", text: JSON.stringify(coupon, null, 2) }] };
  }
);

server.tool(
  "list_coupons",
  "List all coupons in your Stripe account. Example: show me all active discount coupons.",
  {
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results. Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ limit, starting_after }) => {
    const params = { limit };
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/coupons", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "delete_coupon",
  "Delete a coupon by ID. This does not affect existing subscriptions using the coupon. Example: delete expired coupon SUMMER25.",
  {
    coupon_id: z.string().describe("Coupon ID to delete. Example: 'SUMMER25' or 'Z4OV52SU'"),
  },
  async ({ coupon_id }) => {
    const result = await stripeDelete(`/coupons/${coupon_id}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "apply_coupon",
  "Apply a coupon discount to an existing customer or subscription. Example: apply VIP20 coupon to customer cus_abc123.",
  {
    target_type: z.enum(["customer", "subscription"]).describe("Whether to apply to a customer or subscription"),
    target_id: z.string().describe("Customer ID (cus_...) or Subscription ID (sub_...)"),
    coupon: z.string().describe("Coupon ID to apply. Example: 'SUMMER25'"),
  },
  async ({ target_type, target_id, coupon }) => {
    let result;
    if (target_type === "customer") {
      result = await stripePost(`/customers/${target_id}`, { coupon });
    } else {
      result = await stripePost(`/subscriptions/${target_id}`, { coupon });
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_promotion_code",
  "Create a shareable promotion code linked to a coupon. Example: create promo code LAUNCH50 for 50% off coupon, limited to 200 uses.",
  {
    coupon: z.string().describe("Coupon ID this promo code redeems. Example: 'Z4OV52SU'"),
    code: z.string().describe("The actual promo code string. Example: 'LAUNCH50'"),
    max_redemptions: z.number().int().positive().optional().describe("Max times this code can be used"),
    expires_at: z.number().int().optional().describe("Unix timestamp when code expires"),
    active: z.boolean().default(true).describe("Whether the promo code is active. Default: true"),
  },
  async ({ coupon, code, max_redemptions, expires_at, active }) => {
    const body = { coupon, code, active };
    if (max_redemptions) body.max_redemptions = max_redemptions;
    if (expires_at) body.expires_at = expires_at;
    const result = await stripePost("/promotion_codes", body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// 6. Products & Prices
// ---------------------------------------------------------------------------

server.tool(
  "create_product",
  "Create a new product in Stripe. Example: create a 'Pro Plan' product for SaaS monthly subscription.",
  {
    name: z.string().describe("Product name. Example: 'Pro Plan'"),
    description: z.string().optional().describe("Product description shown to customers"),
    active: z.boolean().default(true).describe("Whether product is available. Default: true"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  },
  async ({ name, description, active, metadata }) => {
    const body = { name, active };
    if (description) body.description = description;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    const product = await stripePost("/products", body);
    return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
  }
);

server.tool(
  "create_price",
  "Create a price for a product (one-time or recurring). Example: create $29/month recurring price for product prod_abc123.",
  {
    product: z.string().describe("Product ID. Example: 'prod_NWjs8kKbJWmuuc'"),
    unit_amount: z.number().int().positive().describe("Price in smallest currency unit. Example: 2900 = $29.00"),
    currency: z.string().min(3).max(3).describe("Three-letter ISO currency code. Example: 'usd'"),
    recurring_interval: z.enum(["day", "week", "month", "year"]).optional()
      .describe("Billing interval for recurring price. Omit for one-time prices"),
    recurring_interval_count: z.number().int().positive().default(1)
      .describe("Number of intervals between billings. Example: 3 for every 3 months"),
    nickname: z.string().optional().describe("Internal nickname for this price. Example: 'Pro Monthly'"),
  },
  async ({ product, unit_amount, currency, recurring_interval, recurring_interval_count, nickname }) => {
    const body = { product, unit_amount, currency };
    if (recurring_interval) {
      body["recurring[interval]"] = recurring_interval;
      body["recurring[interval_count]"] = recurring_interval_count || 1;
    }
    if (nickname) body.nickname = nickname;
    const price = await stripePost("/prices", body);
    return { content: [{ type: "text", text: JSON.stringify(price, null, 2) }] };
  }
);

server.tool(
  "list_products",
  "List all products in your Stripe catalog. Example: show me all active products.",
  {
    active: z.boolean().optional().describe("Filter by active status. Omit for all products"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results. Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ active, limit, starting_after }) => {
    const params = { limit };
    if (active !== undefined) params.active = active;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/products", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_prices",
  "List prices, optionally filtered by product. Example: show all prices for product prod_abc123.",
  {
    product: z.string().optional().describe("Filter by product ID"),
    active: z.boolean().optional().describe("Filter by active status"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results. Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ product, active, limit, starting_after }) => {
    const params = { limit };
    if (product) params.product = product;
    if (active !== undefined) params.active = active;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/prices", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// 7. Refunds
// ---------------------------------------------------------------------------

server.tool(
  "create_refund",
  "Issue a refund for a charge or payment intent. Example: refund $25 of charge ch_abc123 due to customer complaint.",
  {
    charge: z.string().optional().describe("Charge ID to refund. Example: 'ch_3OkL2M2eZvKYlo2C1234'"),
    payment_intent: z.string().optional().describe("PaymentIntent ID to refund. Example: 'pi_3OkL2M2eZvKYlo2C1234'"),
    amount: z.number().int().positive().optional().describe("Amount to refund in smallest currency unit. Omit for full refund"),
    reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional().describe("Refund reason"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  },
  async ({ charge, payment_intent, amount, reason, metadata }) => {
    if (!charge && !payment_intent) throw new Error("Either charge or payment_intent is required");
    const body = {};
    if (charge) body.charge = charge;
    if (payment_intent) body.payment_intent = payment_intent;
    if (amount) body.amount = amount;
    if (reason) body.reason = reason;
    if (metadata) Object.entries(metadata).forEach(([k, v]) => { body[`metadata[${k}]`] = v; });
    const refund = await stripePost("/refunds", body);
    return { content: [{ type: "text", text: JSON.stringify(refund, null, 2) }] };
  }
);

server.tool(
  "list_refunds",
  "List refunds, optionally filtered by charge. Example: show all refunds issued in the past month.",
  {
    charge: z.string().optional().describe("Filter by charge ID"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results. Default: 20"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ charge, limit, starting_after }) => {
    const params = { limit };
    if (charge) params.charge = charge;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/refunds", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// 8. Reports / Balance
// ---------------------------------------------------------------------------

server.tool(
  "get_balance",
  "Get your current Stripe account balance, including available and pending funds. Example: what is my current Stripe balance?",
  {},
  async () => {
    const balance = await stripeGet("/balance");
    return { content: [{ type: "text", text: JSON.stringify(balance, null, 2) }] };
  }
);

server.tool(
  "list_balance_transactions",
  "List balance transactions (charges, refunds, payouts, fees). Example: show me all balance transactions from the past 7 days.",
  {
    type: z.enum(["charge", "refund", "adjustment", "application_fee", "application_fee_refund", "transfer", "payout"]).optional()
      .describe("Filter by transaction type"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of results. Default: 20"),
    created_after: z.number().int().optional().describe("Unix timestamp to filter transactions created after this date"),
    starting_after: z.string().optional().describe("Cursor for pagination"),
  },
  async ({ type, limit, created_after, starting_after }) => {
    const params = { limit };
    if (type) params.type = type;
    if (created_after) params["created[gte]"] = created_after;
    if (starting_after) params.starting_after = starting_after;
    const result = await stripeGet("/balance_transactions", params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_report_run",
  "Kick off a Stripe Sigma report run and get the download URL when complete. Example: run a monthly revenue report for March 2024.",
  {
    report_type: z.string().describe("Report type ID. Example: 'balance.summary.1', 'activity.summary.1', 'payouts.itemized.3'"),
    interval_start: z.number().int().describe("Report period start as Unix timestamp. Example: 1709251200 for March 1, 2024"),
    interval_end: z.number().int().describe("Report period end as Unix timestamp. Example: 1711929600 for April 1, 2024"),
    timezone: z.string().default("Etc/UTC").describe("Timezone for report. Default: 'Etc/UTC'. Example: 'America/New_York'"),
  },
  async ({ report_type, interval_start, interval_end, timezone }) => {
    const body = {
      report_type,
      "parameters[interval_start]": interval_start,
      "parameters[interval_end]": interval_end,
      "parameters[timezone]": timezone,
    };
    const run = await stripePost("/reporting/report_runs", body);
    return { content: [{ type: "text", text: JSON.stringify(run, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Express app + MCP transport
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "stripe-complete", version: "1.0.0" });
});

// MCP endpoint — stateless, one transport per request
app.all("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`stripe-complete MCP server listening on port ${PORT}`);
});
