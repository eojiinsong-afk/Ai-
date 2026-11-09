# Node 22.13+ 내장 SQLite 사용. 설치할 패키지가 없어 이미지가 작다.
FROM node:22-slim
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
# npm 을 거치지 않고 바로 실행해야 종료 신호(SIGTERM)를 받아 DB를 닫을 수 있다
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
