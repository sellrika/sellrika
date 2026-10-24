# ---- build: frontend assets + single compiled binary ----
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build \
&& NODE_ENV=production bun build ./app/server.ts --outfile=compiled-server --compile --minify --sourcemap

# ---- runtime: no Bun, just the binary + built assets ----
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 DB_CONNECTION=sqlite DB_FILE=/app/data/pos.db
COPY --from=build /app/compiled-server ./compiled-server
COPY --from=build /app/public/build ./public/build
# the built-in extensions, bundled by `bun run build` (server code: kept out of public/)
COPY --from=build /app/build/extensions ./build/extensions
# the server bundle of the pages rendered to HTML on the server (none in the source-available app)
COPY --from=build /app/build/ssr ./build/ssr
RUN mkdir -p data storage/uploads storage/extensions
VOLUME ["/app/data", "/app/storage"]
EXPOSE 3000
ENTRYPOINT ["./compiled-server"]
