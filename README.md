# MII FITT Server

A small Express backend that handles Stripe Connect for MII FITT: coach payout
onboarding, client payments with a platform fee, and webhook events.

## What this does

- **Coach onboarding** — creates a Stripe Express connected account per coach
  and hands back a Stripe-hosted onboarding link. Coaches enter their own bank
  details directly with Stripe; this server never sees or stores them.
- **Payments** — creates a Checkout Session for a client paying a coach
  (one-time/prepaid or monthly subscription), automatically splitting off
  MII FITT's platform fee and sending the rest to the coach's account.
- **Webhooks** — listens for Stripe events like a completed onboarding or a
  successful payment, and updates the local data store.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment file and fill in your own keys:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and add your Stripe **test-mode** secret key
   (`sk_test_...`). Never commit the real `.env` file.

3. Turn on Stripe Connect in your Stripe Dashboard (Connect > Settings) if you
   haven't already, and choose **Express** accounts.

4. Run the server:
   ```bash
   npm start
   ```
   It starts on `http://localhost:4242` by default.

## Testing webhooks locally

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli), then run:
```bash
stripe listen --forward-to localhost:4242/api/webhooks/stripe
```
This prints a `whsec_...` value — put that in your `.env` as
`STRIPE_WEBHOOK_SECRET`.

## Trying the flow end to end

1. **Onboard a test coach:**
   ```bash
   curl -X POST http://localhost:4242/api/coach/onboard \
     -H "Content-Type: application/json" \
     -d '{"coachId": "coach_123", "email": "coach@example.com"}'
   ```
   Open the returned `url` in a browser and fill out Stripe's test onboarding
   form (test mode accepts fake info — Stripe's docs list what to use).

2. **Check onboarding status:**
   ```bash
   curl http://localhost:4242/api/coach/status/coach_123
   ```
   Wait until `"onboarded": true`.

3. **Create a test payment:**
   ```bash
   curl -X POST http://localhost:4242/api/payments/checkout \
     -H "Content-Type: application/json" \
     -d '{"coachId": "coach_123", "amountUsd": 150, "mode": "payment", "description": "Prepaid coaching package"}'
   ```
   Open the returned `url` and pay with Stripe's test card `4242 4242 4242 4242`,
   any future expiry date, and any CVC.

## What's still a placeholder here

- **`db.js`** is a flat JSON file, fine for testing, not for production. Swap
  it for a real database (Postgres, SQLite, etc.) before going live — keep the
  same function names so the rest of the code doesn't need to change.
- **Front-end integration** — this server exposes the API; your MII FITT app's
  "Advertise"/"Billing" screens would call `/api/coach/onboard` and
  `/api/payments/checkout` instead of the manual mock-up currently in the
  prototype.
- **Going live** — once everything works in test mode, swap `sk_test_...` for
  your live secret key, add a real webhook endpoint URL in the Stripe
  Dashboard (instead of the CLI), and add proper error handling/logging.

## Reminder on keys

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only. Never put
  them in front-end code, never commit `.env` to git.
- Your app's front-end only ever needs your **publishable** key
  (`pk_test_...` / `pk_live_...`).
