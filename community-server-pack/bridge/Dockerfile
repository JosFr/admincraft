FROM joanroig/admincraft-websocket@sha256:a8020390df523c3c809fcac92b0f52e9362c3f79d5f8b520472f3b9207850665

WORKDIR /usr/src/app

ENV BRIDGE_VERSION=1.3.0-rc3

COPY server.js .
COPY push-service.js .
COPY minecraft-backend.js .
COPY multicraft-client.js .
