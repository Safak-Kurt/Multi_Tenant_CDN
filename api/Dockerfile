FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev


FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules

COPY package*.json ./

COPY server.js ./
COPY db ./db
COPY migrations ./migrations
COPY routes ./routes
COPY services ./services
COPY middleware ./middleware

USER node

EXPOSE 4000

CMD ["sh", "-c", "npm run migrate && npm start"]
