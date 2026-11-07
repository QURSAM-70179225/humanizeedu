FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "--no-warnings", "server.js"]
