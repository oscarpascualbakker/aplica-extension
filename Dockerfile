# Entorno de desarrollo y CI local. No hay Node en el equipo: todo corre aquí.
# Versión exacta de Node 22 LTS; zip hace falta para `npm run package`.
FROM node:22.23.5-alpine
RUN apk add --no-cache zip openssl
WORKDIR /app
