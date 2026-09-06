# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# A build-time placeholder: the schema is validated at runtime, not at build.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV AUTH_SECRET=build-time-placeholder-not-used
RUN npm run build

# Migrations and the role sync need drizzle-kit and tsx, which are dev
# dependencies and deliberately absent from the runtime image. They get their
# own small image so a deploy can run them without shipping a toolchain into
# the container that serves customers.
FROM node:22-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY drizzle ./drizzle
COPY drizzle.config.ts tsconfig.json package.json ./
COPY src/server/db ./src/server/db
# env.ts is what db/index.ts reads its connection string through; without it
# the role sync would crash on a module it cannot resolve.
COPY src/server/env.ts ./src/server/env.ts
COPY src/lib ./src/lib
ENV NODE_ENV=production
CMD ["npm", "run", "db:migrate"]

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Migrations and the compiled worker travel with the image.
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
