# Commands

## Development

Install dependencies:

```bash
pnpm install
```

Build the monorepo:

```bash
pnpm build
```

Run tests:

```bash
pnpm test
```

Run the API app in local dev mode:

```bash
pnpm dev
```

## Docker

Build and run Deployery in the foreground:

```bash
docker compose up --build
```

Build and run in the background:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f
```

Stop containers:

```bash
docker compose down
```

Stop containers and delete persistent data:

```bash
docker compose down -v
```

## Quick Rule Of Thumb

Use `pnpm build` when you want to build the source code on your machine.

Use `docker compose up --build` when you want to run the actual self-hosted
Deployery product.
