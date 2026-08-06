# ── Fase 14: Dockerfile corregido — sin secretos en imagen ────────────────────
#
# NUNCA copiar .env dentro de la imagen Docker.
# Los secretos se inyectan en runtime mediante variables de entorno del orquestador.
#
# Build: docker build -t liora-camward .
# Run:   docker run -e DATABASE_URL=... -e SESSION_SECRET=... -p 13000:13000 liora-camward

FROM node:22-slim AS builder

WORKDIR /app
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

# Fijar versión exacta de pnpm — no usar 'latest'
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Copiar solo manifiestos primero (mejora cache de Docker)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/detection-core/package.json ./packages/detection-core/
COPY packages/forensics/package.json ./packages/forensics/
COPY packages/config/package.json ./packages/config/

# Instalar dependencias (sin devDeps en prod build)
RUN pnpm install --frozen-lockfile

# Copiar código fuente (EXCLUYE .env por .dockerignore)
COPY . .

# Verificar que .env no esté presente antes de compilar
RUN test ! -f .env || (echo "ERROR: .env no debe estar en el contexto de Docker" && exit 1)

RUN pnpm run build && (test -d public || mkdir public)

# ── Runner stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# NO incluir ENV con secretos — se inyectan en runtime

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Crear usuario no-root para seguridad
RUN addgroup --system --gid 1001 liora && \
    adduser --system --uid 1001 liora

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/packages ./packages

# Solo dependencias de producción
RUN pnpm install --frozen-lockfile --prod

# Cambiar a usuario no-root
USER liora

EXPOSE 13000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:13000/api/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["pnpm", "start"]
