# --- build stage: compile TypeScript to dist/ ---
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage: prod deps + compiled output only ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# The host injects PORT; the app reads process.env.PORT (defaults to 3000).
EXPOSE 3000
CMD ["node", "dist/index.js"]
