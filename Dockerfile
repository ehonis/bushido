# Bushido: the server and the built app in one small image. The training log,
# settings and the owner account live in /data; mount a volume there.
FROM node:22-alpine AS build
WORKDIR /src
COPY app/package.json app/package-lock.json app/
RUN npm --prefix app ci --no-audit --no-fund
COPY . .
RUN npm --prefix app run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    BUSHIDO_DATA_DIR=/data \
    BUSHIDO_PORT=8099 \
    BUSHIDO_BIND=0.0.0.0
COPY --from=build /src/server ./server
COPY --from=build /src/content ./content
COPY --from=build /src/examples ./examples
COPY --from=build /src/docs ./docs
COPY --from=build /src/dist ./dist
COPY --from=build /src/README.md /src/LICENSE ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8099/api/health >/dev/null || exit 1
CMD ["node", "server/server.js"]
