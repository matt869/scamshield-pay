# ScamShield Pay

[![CI](https://github.com/matt869/scamshield-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/matt869/scamshield-pay/actions/workflows/ci.yml)

**Live demo:** https://scamshield-pay.forever-online.workers.dev

## Why

Scam texts and emails reach people every day, and many of them cannot tell a fake toll notice or a "grandchild in trouble" from a real one. They need a plain-language check before any money moves. People who already paid need help fast: who to call, what to say, and a dispute letter that fits their case. ScamShield Pay is for both groups, in English, Spanish, and Filipino.

## For judges

- The live site runs in the **PayPal sandbox**. No real money moves.
- The scam check is free. Paste a message, or click one of the sample messages.
- To test the paid dispute kit, open a result, click the pay button, and log in with a sandbox **personal** account from your own PayPal developer dashboard (**Testing Tools → Sandbox Accounts**).

## Built for the PayPal AI Hackathon

**PayPal**

- Orders API v2: the server creates and captures each order.
- Invoicing API v2: the reader can get the kit by invoice email.
- Webhooks with signature verification: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.REFUNDED`.
- The PayPal JavaScript SDK button on the pay page.
- The server checks the amount and currency in PayPal's own response before it unlocks a kit. A refunded kit stays locked.

**AI**

- The live site uses **Google Gemini**. Claude is also supported: set `AI_PROVIDER=claude`.
- The model (a) classifies the message, names the scam type, and quotes each red flag from the message, and (b) writes the dispute letter, phone script, and evidence checklist for the reader's case.
- Guardrails in `lib/guardrails.ts` run after the model. For example, a demand for gift cards, crypto, or remote access can never get a "low" verdict, and quotes that are not in the message are not marked.

**Hosting**

- Cloudflare Workers, with data in Cloudflare D1.

Paste a suspicious text or email and get a free, plain-language verdict before any money moves. People who already paid get a free step-by-step guide, and can buy a dispute kit: a letter, a phone script, and an evidence checklist written for their case.

English, Spanish, and Filipino. Built with Next.js, PayPal, and Claude or Google Gemini.

![A result page: a red "Stop. Do not pay." stamp above the reader's message, with each warning sign highlighted, numbered, and explained alongside](docs/screenshots/result.png)

<table>
  <tr>
    <td width="68%"><img src="docs/screenshots/home.png" alt="The home page, where a message is pasted in, beside an example of a marked-up result"></td>
    <td width="32%"><img src="docs/screenshots/result-phone.png" alt="The same result on a phone"></td>
  </tr>
</table>

<sub>Screenshots use the built-in sample message with an example report.</sub>

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `AI_PROVIDER` | `gemini` or `claude` (default). The live site uses `gemini` | Your choice |
| `GEMINI_API_KEY` | Checks and dispute kits with Gemini, free tier | [Google AI Studio](https://aistudio.google.com/apikey) |
| `DEMO_MODE` | `true` runs without any AI, using labelled pattern rules | Testing only |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Taking payment | [PayPal developer dashboard](https://developer.paypal.com/dashboard/applications), Sandbox app to start |
| `PAYPAL_WEBHOOK_ID` | Invoices, pending payments, refunds | See "PayPal webhook" below |
| `PAYPAL_ENV` | `sandbox` or `live` | Defaults to sandbox |
| `APP_URL` | The link inside invoice emails | Your public URL |
| `KIT_PRICE_USD` | Kit price, like `9.00` | Your decision |

Without AI credentials the check reports that it is unavailable and tells the reader not to pay yet. Without PayPal credentials the pay page says payments are unavailable. The help page needs neither.

### PayPal webhook

Create a webhook in your PayPal app pointing at `https://YOUR-DOMAIN/api/paypal/webhook` and put its ID in `PAYPAL_WEBHOOK_ID`. Sandbox and live have different IDs. Subscribe to:

- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`
- `INVOICING.INVOICE.PAID`
- `INVOICING.INVOICE.REFUNDED`

Without the webhook, immediate PayPal and card payments still unlock the kit, but paid invoices and payments that clear later never do, and refunds never close it. PayPal's Webhooks simulator sends mock events that cannot pass signature verification, so test with real sandbox payments.

## How it works

```
Message ─ POST /api/analyze ─ Gemini or Claude ─ guardrails ─ store ─ /result
                                                              │
                     free guide: /help  ◄─────────────────────┤
                                                              ▼
 /pay ─ create-order ─ PayPal ─ capture-order ─ checks ─ paid ─ /success ─ POST /api/dispute ─ kit
   └─── create-invoice ─ PayPal email ─ webhook ─ checks ─ paid ─┘
```

| Path | What it holds |
| --- | --- |
| `lib/claude.ts` | Claude calls, the schema sent to the API, and the switch to Gemini |
| `lib/gemini.ts` | Gemini calls, with a backup key and a fallback model |
| `lib/prompts/` | The classifier and dispute-letter prompts |
| `lib/guardrails.ts` | Rules that hold whatever the model returns |
| `lib/paypal.ts` | PayPal REST client and payment verification |
| `lib/store.ts` | Records and retention |
| `lib/i18n.ts` | All interface copy, in both languages |
| `data/resources.json` | Official contacts and per-payment-method guidance |

### Safety decisions worth keeping

The message being judged may be written by a criminal, and the worst failure is false reassurance.

- **No verdict is better than a guessed one.** If the model refuses, errors, or returns something outside the schema, the reader is told we could not check it and not to pay yet.
- **Guardrails run after the model.** Demands for gift cards or crypto, remote-access tools, requests for secrecy, and text aimed at an AI checker all raise a "low" verdict to "medium". Next steps containing links or phone numbers are dropped, because they could come from the sender. Quotes not found in the message are not marked.
- **"Low" never means safe.** The page always says we cannot confirm who sent the message.
- **Nothing from the message is clickable.** It is rendered as plain text.
- **The browser never decides a payment.** The server sets the price, and the kit unlocks only after PayPal's own response matches the check, amount, and currency. Webhooks are signature-verified and invoice state is re-fetched from PayPal. A refunded kit stays closed.
- **Emergency help is never behind the paywall.** The guide and official contacts are free.

## Tests

```bash
npm test            # guardrails, marking, payment and webhook rules
npm run typecheck
```

These use mocked PayPal and AI responses and do not call Gemini or Claude. GitHub Actions runs the type check, tests, and a production build on every push.

## Deploying to Cloudflare (free)

The app runs on Cloudflare Workers, with data in Cloudflare D1, so it stays up when your computer is off.

```bash
npx wrangler login                                        # once
npx wrangler d1 create scamshield-pay                     # once; put the id in wrangler.jsonc
npx wrangler d1 migrations apply scamshield-pay --remote  # once, and after new migrations
npx wrangler secret put PAYPAL_CLIENT_ID                  # and PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID,
                                                          # GEMINI_API_KEY, GEMINI_BACKUP_API_KEY
npm run cf:deploy                                         # build and publish
```

Keys are stored as encrypted Cloudflare secrets and never appear in `wrangler.jsonc` or git. Non-secret settings, such as `AI_PROVIDER` and `PAYPAL_ENV`, are under `vars` in `wrangler.jsonc`. Point the PayPal webhook at `https://<your-worker>.workers.dev/api/paypal/webhook`.

The free Workers plan allows 3 MB of compressed code (this app is about 1.4 MB) and limited CPU time per request; the Gemini wait does not count toward it.

## Deploying

Outside Cloudflare, `lib/store.ts` writes a JSON file (`STORE_FILE`, default `.data/store.json`), so as written the app needs **one long-running server with a persistent disk**, such as a small VPS, Fly.io, or Render with a volume. On serverless hosting such as Vercel the file does not persist and instances do not share it: results and payment records would be lost. To deploy there, replace `lib/store.ts` with a database; nothing else touches the file. The rate limiter in `lib/rate-limit.ts` is also per process.

### Security

- `npm start` and `npm run dev` listen on `127.0.0.1` only, so nobody on the same Wi-Fi can reach the app directly. Publish it through a proxy or tunnel, such as `cloudflared tunnel --url http://localhost:3000`.
- Visitor addresses come from Cloudflare's `cf-connecting-ip`, which visitors cannot fake. Each visitor gets 10 checks an hour, and the whole site is capped (`SITE_CHECKS_PER_HOUR`, default 300) so nobody can drain the AI quota.
- API routes accept only JSON, which blocks cross-site form posts, and cap body size while reading.
- Strict security headers: a Content-Security-Policy that allows only this site and PayPal, HSTS, frame blocking, and no caching of result pages.
- Keys live only in `.env.local`, which git ignores. Nothing secret is sent to the browser except the PayPal client ID, which PayPal designs to be public.
- Dependabot opens pull requests for dependency security fixes.

### Before taking real money

- [ ] Test the full flow against the PayPal sandbox and a real Gemini or Claude key.
- [ ] Add a privacy policy and terms, including a refund policy. The app stores submitted messages for 24 hours, or 30 days once an invoice is sent or a kit is paid for.
- [ ] Have a lawyer review the dispute kit and the payment-deadline guidance in `data/resources.json`.
- [ ] Have a native speaker review the Spanish.
- [ ] Back up the store file, and set `PAYPAL_ENV=live` with live credentials and a live webhook ID.
