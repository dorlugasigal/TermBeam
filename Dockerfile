FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev
COPY bin/ bin/
COPY src/ src/
COPY public/ public/

EXPOSE 3456
CMD ["node", "bin/termbeam.js", "--no-tunnel", "--no-password"]
