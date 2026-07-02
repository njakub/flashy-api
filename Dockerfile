# syntax=docker/dockerfile:1

# ---- Build stage ----------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

# OpenSSL is required by Prisma's engines (present in both stages).
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
# Generate the Prisma client (into src/generated/prisma) BEFORE the Nest build,
# so `nest build` compiles it into dist/. Because this runs on the linux
# builder, the linux Prisma engine is the one that ends up in node_modules.
RUN npx prisma generate
RUN npm run build

# ---- Runtime stage --------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy the full node_modules (incl. the prisma CLI + its linux engine) so the
# Fly release_command can run `prisma migrate deploy`. dist/ already contains
# the compiled generated client.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json

EXPOSE 3001
CMD ["node", "dist/main.js"]
