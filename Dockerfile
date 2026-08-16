# 游戏预约系统 - 生产镜像
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# 仅复制依赖清单并安装生产依赖（利用层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制应用代码
COPY server.js store.js ./
COPY public ./public

# 数据目录：在 Sealos 中把持久卷挂载到这里，保证预约数据不丢失
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
