# One-process production image: the proxy serving the pre-built web app on
# one origin (see docs/INSTALL.md). State lives in /data (cluster.json +
# auth.json) — mount a volume there.
#
# The runtime stage needs no package manager: the proxy's only dependency
# is the workspace @clusterfuck/shared package (plain .ts, resolved through
# one node_modules symlink; Node 24 strips types natively).

FROM node:24-alpine AS web-build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/proxy/package.json packages/proxy/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @clusterfuck/web build

FROM node:24-alpine
ENV PORT=4000 \
    CLUSTERFUCK_CONFIG=/data/cluster.json \
    CLUSTERFUCK_AUTH_CONFIG=/data/auth.json \
    CLUSTERFUCK_WEB_DIST=/app/packages/web/dist
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/proxy/package.json packages/proxy/
COPY packages/proxy/src packages/proxy/src
COPY --from=web-build /app/packages/web/dist packages/web/dist
RUN mkdir -p node_modules/@clusterfuck /data \
  && ln -s /app/packages/shared node_modules/@clusterfuck/shared \
  && find packages -name '*.test.ts' -delete \
  && chown node /data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "packages/proxy/src/index.ts"]
