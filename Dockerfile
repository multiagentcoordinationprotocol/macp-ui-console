# syntax=docker/dockerfile:1
#
# Production image for the MACP UI Console (Next.js standalone output). W3.7 one-command self-host.
#
# Backend wiring is runtime config read by the server-side proxy on every request, so one image serves
# any stack:
#   MACP_CONTROL_PLANE_BASE_URL   (required)  e.g. http://macp-control-plane:3001
#   MACP_CONTROL_PLANE_API_KEY    (optional)  sent upstream as a Bearer token
#   MACP_PLAYGROUND_BASE_URL      (required)  e.g. http://macp-playground:3000
#   MACP_PLAYGROUND_API_KEY       (optional)  sent upstream as x-api-key
#   PORT / HOSTNAME               (optional)  default 3000 / 0.0.0.0
#
# NEXT_PUBLIC_* values are inlined into the browser bundle by `next build`, so they are build args,
# not runtime env. The image defaults to real mode (demo off); rebuild with --build-arg to change.

ARG NODE_VERSION=22.22.2

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_MACP_UI_DEMO_MODE=false
ARG NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL=self-hosted
ARG NEXT_PUBLIC_JAEGER_BASE_URL=
ENV NEXT_PUBLIC_MACP_UI_DEMO_MODE=${NEXT_PUBLIC_MACP_UI_DEMO_MODE} \
    NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL=${NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL} \
    NEXT_PUBLIC_JAEGER_BASE_URL=${NEXT_PUBLIC_JAEGER_BASE_URL} \
    MACP_UI_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The server needs only node. npm and corepack ship with the base image and carry their own
# dependency CVEs (e.g. node-tar), so they are removed from the runtime layer.
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# /docs reads these from the working directory at request time.
COPY --from=build --chown=node:node /app/docs ./docs
COPY --from=build --chown=node:node /app/docs-content ./docs-content
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
