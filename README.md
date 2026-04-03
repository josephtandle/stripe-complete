# Stripe Complete MCP Server

Stop copying Stripe dashboard data into spreadsheets. Manage payments, subscriptions, and revenue — all from your AI assistant.

## Overview

Stripe Complete is a production-grade MCP (Model Context Protocol) server that wraps the entire Stripe payments API. Connect it to Claude, Cursor, or any MCP-compatible AI and manage your entire Stripe account without leaving your chat window.

## Tools

| Category | Tool | Description |
|----------|------|-------------|
| Payment Intents | `create_payment_intent` | Create a new payment intent |
| Payment Intents | `confirm_payment_intent` | Confirm and capture a payment |
| Payment Intents | `cancel_payment_intent` | Cancel an uncaptured payment |
| Payment Intents | `list_payment_intents` | List recent payment intents |
| Customers | `create_customer` | Create a new customer record |
| Customers | `get_customer` | Retrieve a customer by ID |
| Customers | `update_customer` | Update customer details |
| Customers | `list_customers` | List customers, filter by email |
| Customers | `delete_customer` | Delete a customer permanently |
| Subscriptions | `create_subscription` | Subscribe a customer to a plan |
| Subscriptions | `update_subscription` | Change plan, quantity, or discounts |
| Subscriptions | `cancel_subscription` | Cancel immediately or at period end |
| Subscriptions | `list_subscriptions` | List subscriptions by status |
| Invoices | `create_invoice` | Create a draft invoice |
| Invoices | `send_invoice` | Send invoice to customer via email |
| Invoices | `list_invoices` | List invoices by status |
| Invoices | `get_invoice` | Get full invoice details |
| Invoices | `pay_invoice` | Trigger payment on an open invoice |
| Coupons | `create_coupon` | Create a discount coupon |
| Coupons | `list_coupons` | List all coupons |
| Coupons | `delete_coupon` | Delete a coupon |
| Coupons | `apply_coupon` | Apply a coupon to a customer or subscription |
| Coupons | `create_promotion_code` | Create a shareable promo code |
| Products | `create_product` | Create a new product |
| Products | `create_price` | Create a one-time or recurring price |
| Products | `list_products` | List all products |
| Products | `list_prices` | List prices for a product |
| Refunds | `create_refund` | Issue a full or partial refund |
| Refunds | `list_refunds` | List recent refunds |
| Reports | `get_balance` | Get current account balance |
| Reports | `list_balance_transactions` | List all balance transactions |
| Reports | `create_report_run` | Run a Stripe Sigma report |

## Quick Start

### 1. Get your Stripe API key

Log in to [dashboard.stripe.com](https://dashboard.stripe.com) and go to Developers > API keys. Copy your secret key (starts with `sk_test_` or `sk_live_`).

### 2. Add to Claude Desktop

```json
{
  "mcpServers": {
    "stripe-complete": {
      "url": "https://mcpize.com/mcp/stripe-complete",
      "env": {
        "STRIPE_SECRET_KEY": "sk_test_your_key_here"
      }
    }
  }
}
```

### 3. Start using it

Ask Claude:
- "What's my current Stripe balance?"
- "List my 10 most recent subscriptions"
- "Create a 20% off coupon called WELCOME20"
- "Refund customer cus_abc123's last charge"

## Requirements

- Node.js 18+
- A Stripe account with an API key
- Any MCP-compatible AI client

## Self-hosting

```bash
STRIPE_SECRET_KEY=sk_test_... PORT=8080 npm start
```

---

Built and distributed via [mastermindshq.business](https://mastermindshq.business)
