FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npx vite build
ENV PORT=3001
EXPOSE 3001
CMD ["npx", "tsx", "server/index.ts"]
