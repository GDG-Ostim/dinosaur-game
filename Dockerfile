FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
# Node doğrudan PID 1: SIGTERM'i alıp kapanış yedeği alabilsin.
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
