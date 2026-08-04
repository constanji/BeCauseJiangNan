# v0.8.1-rc2

# Base node image
FROM node:20-alpine AS node

# Install jemalloc
RUN apk add --no-cache jemalloc
RUN apk add --no-cache python3 py3-pip uv

# Set environment variable to use jemalloc
ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2

# Add `uv` for extended MCP support
COPY --from=ghcr.io/astral-sh/uv:0.6.13 /uv /uvx /bin/
RUN uv --version

RUN mkdir -p /app && chown node:node /app
WORKDIR /app

USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node api/package.json ./api/package.json
COPY --chown=node:node client/package.json ./client/package.json
COPY --chown=node:node packages/data-provider/package.json ./packages/data-provider/package.json
COPY --chown=node:node packages/data-schemas/package.json ./packages/data-schemas/package.json
COPY --chown=node:node packages/api/package.json ./packages/api/package.json

RUN \
    # Allow mounting of these files, which have no default
    touch .env ; \
    # Create directories for the volumes to inherit the correct permissions
    mkdir -p /app/client/public/images /app/api/logs /app/uploads ; \
    npm config set fetch-retry-maxtimeout 600000 ; \
    npm config set fetch-retries 5 ; \
    npm config set fetch-retry-mintimeout 15000

# Copy and build agents-because before installing dependencies
COPY --chown=node:node agents-because/package.json ./agents-because/package.json
COPY --chown=node:node agents-because/tsconfig*.json ./agents-because/
COPY --chown=node:node agents-because/rollup.config.js ./agents-because/
COPY --chown=node:node agents-because/husky-setup.js ./agents-because/husky-setup.js
COPY --chown=node:node agents-because/config ./agents-because/config
COPY --chown=node:node agents-because/src ./agents-because/src

ENV HUSKY=0
ENV CI=true

# dist/types/**/*.d.ts is committed to git (see agents-because/.gitignore) and
# arrives here via this COPY too; dist/cjs and dist/esm are gitignored runtime
# bundles that may or may not already exist locally.
COPY --chown=node:node agents-because/dist ./agents-because/dist

RUN \
    cd agents-because && \
    # Only the compiled runtime entry (dist/cjs/main.cjs) matters for `node`
    # to load @because/agents — checking "dist non-empty" here would wrongly
    # skip the rebuild when only dist/types (committed, always present) is on
    # disk but the runtime bundle isn't.
    if [ ! -f "dist/cjs/main.cjs" ]; then \
      echo "Building agents-because runtime bundle (dist/cjs/main.cjs not found)..."; \
      npm install --no-audit --omit=dev && \
      DISABLE_SOURCEMAP=true NODE_OPTIONS="--max-old-space-size=8192" npm run build:runtime; \
    else \
      echo "Using existing dist/cjs, installing dependencies only..."; \
      npm install --no-audit --omit=dev; \
    fi && \
    if [ ! -f "dist/types/index.d.ts" ]; then \
      echo "WARNING: dist/types/index.d.ts missing — packages/api will build with degraded (but non-fatal) type warnings. Run 'npm run build:types' locally and commit dist/types to fix."; \
    fi

# Now install all dependencies including the local agents-because package
RUN npm ci --no-audit

COPY --chown=node:node . .

# Build packages separately with increased memory limit
ENV NODE_OPTIONS="--max-old-space-size=8192"

RUN \
    # Build data-provider first
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:data-provider || (echo "Failed to build data-provider" && exit 1) && \
    # Build data-schemas
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:data-schemas || (echo "Failed to build data-schemas" && exit 1) && \
    # Build api package with extra memory
    NODE_OPTIONS="--max-old-space-size=8192" npm run build:api || (echo "Failed to build api" && exit 1) && \
    # Verify api dist exists
    test -f packages/api/dist/index.js || (echo "packages/api/dist/index.js not found" && exit 1) && \
    # Build client-package
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:client-package || (echo "Failed to build client-package" && exit 1) && \
    # Build client
    cd client && NODE_OPTIONS="--max-old-space-size=4096" npm run build || (echo "Failed to build client" && exit 1) && \
    cd .. && \
    # Prune and clean
    npm prune --production && \
    # 某些构建产物需要 mongodb 运行时依赖（可能未列为 prod dep），显式安装
    npm install mongodb --omit=dev && \
    npm cache clean --force && \
    # 兼容大小写导入：@Because/* -> @because/*
    ln -s /app/node_modules/@because /app/node_modules/@Because || true

# Node API setup
EXPOSE 3080
ENV HOST=0.0.0.0
CMD ["npm", "run", "backend"]

# Optional: for client with nginx routing
# FROM nginx:stable-alpine AS nginx-client
# WORKDIR /usr/share/nginx/html
# COPY --from=node /app/client/dist /usr/share/nginx/html
# COPY client/nginx.conf /etc/nginx/conf.d/default.conf
# ENTRYPOINT ["nginx", "-g", "daemon off;"]
