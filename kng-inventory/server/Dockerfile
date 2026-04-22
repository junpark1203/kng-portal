FROM node:18-alpine

# 앱 디렉터리 생성
WORKDIR /usr/src/app

# 앱 의존성 설치
# 와일드카드를 사용하여 package.json 및 package-lock.json 복사
COPY package*.json ./

RUN npm install

# 앱 소스 추가
COPY . .

# NAS 포트 3000 사용
EXPOSE 3000

# 서버 실행
CMD [ "node", "server.js" ]
