FROM node:26-slim@sha256:a12126cfec3cd85577cb573fa86a588018721098c18fe67fe1a554cc25a1a6a5

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y python3 make g++ \
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
