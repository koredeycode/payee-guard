# Reproducible Payee Guard image: Node 22 + pnpm workspace deps, Next.js web build.
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate
WORKDIR /app

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
# NEXT_PUBLIC_* values are inlined by Next at build time, so they are build args.
ARG NEXT_PUBLIC_NETWORKS=fork,aevum
ARG NEXT_PUBLIC_CHECKOUT_FORK=""
ARG NEXT_PUBLIC_CHECKOUT_AEVUM=""
ARG NEXT_PUBLIC_DEPLOY_BLOCK_FORK=""
ARG NEXT_PUBLIC_REPO_URL=https://github.com/koredeycode/payee-guard
ENV NEXT_PUBLIC_NETWORKS=$NEXT_PUBLIC_NETWORKS \
    NEXT_PUBLIC_CHECKOUT_FORK=$NEXT_PUBLIC_CHECKOUT_FORK \
    NEXT_PUBLIC_CHECKOUT_AEVUM=$NEXT_PUBLIC_CHECKOUT_AEVUM \
    NEXT_PUBLIC_DEPLOY_BLOCK_FORK=$NEXT_PUBLIC_DEPLOY_BLOCK_FORK \
    NEXT_PUBLIC_REPO_URL=$NEXT_PUBLIC_REPO_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# One-shot deploy+seed target: Node + tsx + forge/cast/anvil binaries.
FROM ghcr.io/foundry-rs/foundry:latest AS foundry
FROM build AS toolchain
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=foundry /usr/local/bin/cast /usr/local/bin/cast
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/forge
ENV NETWORK=fork
CMD ["pnpm", "exec", "tsx", "scripts/deploy-and-seed.ts"]

FROM build AS web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start", "--hostname", "0.0.0.0", "--port", "3000"]
