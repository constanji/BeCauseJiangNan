FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

COPY index.js ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV ESB_RUNTIME_CONFIG_PATH=/app/data/runtime-config.json
EXPOSE 13001

CMD ["node", "index.js"]
