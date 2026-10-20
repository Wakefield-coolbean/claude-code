# Sus Station game server: serves the game and hosts online rooms.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html ./
COPY src ./src
COPY server ./server
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/server.mjs"]
