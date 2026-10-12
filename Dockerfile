FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY distribution ./distribution
COPY distribution.js ./
COPY workflows ./workflows
COPY frontend ./frontend
RUN mkdir -p /data && chown node:node /data
ENV STORE_DIR=/data/store BIND_HOST=0.0.0.0
USER node
EXPOSE 3000 8080
CMD ["node", "workflows/server.js"]
