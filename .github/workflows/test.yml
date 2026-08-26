# 테스트 — 브랜치 보호의 "필수 상태 체크"로 걸 수 있게 만든 것.
#
# main 을 보호하려면 요구할 체크가 하나는 있어야 한다.
# 이 워크플로의 `test` 잡이 그 체크다.
name: test

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      # 의존성이 없다. 파일을 열면 그대로 도는 것이 이 저장소의 전제이므로
      # npm install 단계 자체를 두지 않는다.
      - name: 규칙 단위 테스트
        run: node test/logic.test.js

      - name: 저장소 통합 테스트
        run: node test/store.test.js

      - name: 서버 모드 어댑터 테스트
        run: node test/server.test.js

      # schema.sql 을 임시 PostgreSQL 에 실제로 적용해 본다.
      # 러너에는 PostgreSQL 이 설치돼 있지만 서비스가 꺼져 있고 initdb 가
      # PATH 에 없다 — run.sh 가 /usr/lib/postgresql/*/bin 도 뒤지므로 그대로 돈다.
      - name: SQL 스키마 검증
        run: ./scripts/sqltest/run.sh

      # 화면이 실제로 뜨는지. 규칙 테스트가 전부 통과해도
      # app.js 의 오타 하나로 페이지가 빈 화면이 될 수 있다.
      - name: 브라우저에서 열리는지 확인
        run: |
          npm install --no-save playwright@latest
          npx playwright install --with-deps chromium
          node test/smoke.browser.js
