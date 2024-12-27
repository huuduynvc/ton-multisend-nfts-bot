FROM node:18-alpine AS build-stage

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

RUN npm run build

# --- Production Image --- #
FROM node:18-alpine AS production

COPY --from=build-stage /app/dist ./dist
COPY --from=build-stage /app/node_modules ./node_modules

EXPOSE 3000
CMD ["node", "dist/main.js"]

