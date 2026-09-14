# Gainline Server

A small Express app that handles Stripe Connect for Gainline: coach payout
onboarding, client payments, webhook events, and a plain HTML/CSS/JS front-end
(in `/public`) that drives all of it.

## What this does

- **Coach onboarding** — creates a Stripe Express connected account per coach
  and hands back a Stripe-hosted onboarding link. Coaches enter their own bank
  details directly with Stripe; this server never sees or stores them.
- **Payments** — creates a Checkout Session for a client paying a coach
  (one-time/prepaid or monthly subscription). By default 100% goes to the
  coach — Gainline's revenue comes from coach membership tiers and the ad
  listing fee instead (see `PLATFORM_FEE_PERCENT` in `.env` if you want a cut
  of client payments too).
- **Webhooks** — listens for Stripe events like a completed onboarding or a
  successful payment, and updates the local data store.
- **Front-end** (`/public`) — a coach onboarding page, a client "browse
  coaches" + pay page, and the return pages Stripe redirects to. Served from
  this same server at `/`, so no separate dev server or CORS setup is needed.

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
   It starts on `http://localhost:4242` by default. Open that URL in a
   browser to use the actual site (coach onboarding, browsing coaches, and
   paying them) instead of the raw API.

## Testing webhooks locally

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli), then run:
```bash
stripe listen --forward-to localhost:4242/api/webhooks/stripe
```
This prints a `whsec_...` value — put that in your `.env` as
`STRIPE_WEBHOOK_SECRET`.

## Trying the flow end to end

**Through the site (recommended):**

1. Open `http://localhost:4242` and click **I'm a coach**. Fill in a name and
   email, then complete Stripe's test onboarding form (test mode accepts fake
   info — Stripe's docs list what to use).
2. Stripe redirects back to the onboarding-complete page, which checks status
   automatically. Once it shows **Ready**, the coach shows up on
   `/browse.html`.
3. In another tab (or as a different "client"), open `http://localhost:4242`,
   click **I'm a client**, pick the coach, and pay with Stripe's test card
   `4242 4242 4242 4242`, any future expiry date, and any CVC.

**Via the raw API**, if you want to test the backend directly:

1. **Onboard a test coach:**
   ```bash
   curl -X POST http://localhost:4242/api/coach/onboard \
     -H "Content-Type: application/json" \
     -d '{"coachId": "coach_123", "email": "coach@example.com", "name": "Test Coach"}'
   ```
   Open the returned `url` in a browser and fill out Stripe's test onboarding
   form.

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

- **`db.js`** is backed by SQLite (`data.db`, via Node's built-in `node:sqlite`
  — no extra dependency, no native build step). Fine for a single-server
  deployment; if you outgrow one server, move to a hosted Postgres/MySQL
  instead and keep the same exported function names so the rest of the code
  doesn't need to change. On a host with an ephemeral filesystem (most PaaS
  free tiers), attach a persistent disk so `data.db` survives redeploys.
- **Going live** — once everything works in test mode, swap `sk_test_...` for
  your live secret key, add a real webhook endpoint URL in the Stripe
  Dashboard (instead of the CLI), and add proper error handling/logging.

## Reminder on keys

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only. Never put
  them in front-end code, never commit `.env` to git.
- Your app's front-end only ever needs your **publishable** key
  (`pk_test_...` / `pk_live_...`).
