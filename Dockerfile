FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503

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
