# SEKED Lead Operator

## Quick start

1. Copy env

```bash
cp .env.example .env
```

2. Fill in:

- `DATABASE_URL`
- `SERPAPI_API_KEY`

3. Install + generate

```bash
npm i
npm run prisma:generate
```

4. Create tables + seed

```bash
npm run db:push
npm run db:seed
```

5. Run

```bash
npm run run
```

## Extra commands

Propose new candidate queries (disabled by default):

```bash
npm run run -- propose-queries
```

Record outcomes (drives IPS + learning loop):

```bash
npm run run -- outcome --leadId <LEAD_ID> --result WON
```

The CLI will:

- Run a few enabled queries
- Save leads + events
- Print the top outreach-ready leads with a selected template
