FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY extension/package.json extension/
RUN pnpm install --frozen-lockfile --filter "@wordbook/server..."
COPY shared shared
COPY server server
ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/server
# shortcut: runs TypeScript through tsx instead of a compiled build; add a tsc/bundle step if startup time matters.
CMD ["node_modules/.bin/tsx", "src/index.ts"]
