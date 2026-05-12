FROM node:26-slim@sha256:424cafd2a035ed2b2d74acc3142b68b426fb62a47742c80a75e7117db02d6b30

RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev
COPY src/frontend/package.json src/frontend/package-lock.json src/frontend/
RUN cd src/frontend && npm ci
COPY bin/ bin/
COPY src/ src/
RUN cd src/frontend && npm run build && rm -rf /app/src/frontend

EXPOSE 3456
CMD ["node", "bin/termbeam.js", "--no-tunnel", "--no-password"]
