# Seventy

The Club 70 member platform: a REST API, an admin web app and a member mobile app.

The Seventy Hospitality website (seventyhospitality.com) lives in its own repo: [Seventy-Hospitality/seventyhospitality.com](https://github.com/Seventy-Hospitality/seventyhospitality.com).

```
seventy/
├── api/                      # REST API (Fastify, Prisma, Postgres)
├── web/                      # Admin web app (React, Vite)
├── mobile/                   # Member app (Expo / React Native)
├── infra/, deploy/, scripts/ # AWS infrastructure and API deploy scripts
└── .github/workflows/        # CI (pull requests) and API deploy (main)
```

See [CLAUDE.md](CLAUDE.md) for an overview and [api/ARCHITECTURE.md](api/ARCHITECTURE.md) for the architecture.

## Prerequisites

- Node.js 22
- PostgreSQL, running locally
- Optional: the [Stripe CLI](https://docs.stripe.com/stripe-cli), to test billing webhooks

## API (`api/`, http://localhost:3001)

```bash
cd api
npm install
cp .env.example .env    # then fill in DATABASE_URL, JWT_SECRET, and so on
npm run db:migrate      # create the database tables
npm run db:seed         # optional: load test data
npm run dev
```

Useful settings in `.env`:

- `DATABASE_URL` points to your local Postgres database.
- `AUTH_DISABLED=true` skips login during local development.
- Stripe and Resend keys can be test keys. Seeding skips Stripe if the key is left as a placeholder.

Other commands: `npm test`, `npm run db:studio` (browse the database), `npm run db:reset`.

To forward Stripe webhooks to your local API:

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

## Admin web app (`web/`, http://localhost:5173)

Start the API first. The dev server forwards `/api` requests to it.

```bash
cd web
npm install
npm run dev
```

The design system is the `octahedron` npm package. If you have the Octahedron source checked out next to this repo (`../../octahedron`), Vite uses it directly for hot reload. Otherwise it uses the published package.

## Mobile app (`mobile/`)

```bash
cd mobile
npm install
npm start               # opens Expo; press i for iOS or a for Android
```

## CI and deploys

- **Pull requests** run type-checks and tests for the API and web app (`.github/workflows/ci.yml`).
- **Pushes to `main`** that touch `api/`, `web/` or `member-web/` build the API Docker image and push it to AWS ECR. App Runner deploys it automatically (`.github/workflows/deploy.yml`).
