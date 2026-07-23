FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./server.js
COPY public ./public

USER node
EXPOSE 8080

CMD ["npm", "start"]
