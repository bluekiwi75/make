# 마켓데스크 작업 인계 (Claude용)

휴대폰이나 다른 세션에서 이어받을 때 이 문서를 먼저 읽으세요. 처음 인계 내용은 `README-CLAUDE.md`에 있습니다.

## 작업 규칙 (사용자 요청)
- 한국어로 답하고, 결과는 짧게 정리합니다.
- 사용자가 명령할 때마다 `WORK_COUNT.md`의 번호를 1 올립니다. 작업이 끝나면 답변 맨 끝에 `작업 #번호 · 2026-11-22 14:30 KST`처럼 번호와 날짜·시간(`TZ=Asia/Seoul date`로 확인)을 표시합니다. 파일의 번호와 표도 갱신해 같은 커밋에 넣습니다.
- 작업이 끝날 때마다 마켓데스크 화면 캡처를 `SendUserFile`로 보내고, `PushNotification`으로 알림을 보냅니다.
- 작업이 끝나면 아티팩트를 갱신하고 링크(https://claude.ai/artifact/3Rigwfrnbw5tFjr3aLRPHV)를 답변에 꼭 포함합니다. 사용자가 휴대폰에서 화면을 확인합니다.
- 개발 브랜치는 `claude/funny-wozniak-rt4sh9`입니다. 커밋하고 이 브랜치에 푸시합니다. PR은 요청이 있을 때만 만듭니다.
- 운영 사이트(Sites, D1, R2)와 실제 데이터에는 접근하지 않습니다. 샘플 모드(`node run-local.mjs`, 8787 포트)에서 확인합니다.
- 조회 기간 기본값은 이번 달 1일 ~ 오늘이며 `1주일/1개월/3개월/6개월/전체 기간` 버튼이 있습니다.

## 구조
- `public/app.js` 프런트엔드 전체(약 2,500줄). 샘플 모드는 `127.0.0.1`/`localhost`에서만 켜집니다.
- `public/statement.js` 거래명세서 텍스트 파서와 상품 매칭. `public/purchase-scan.js` PDF·이미지 읽기(iframe), `pageText()`가 글자 좌표로 줄을 다시 묶습니다.
- `worker.mjs`, `markets.mjs`, `additional-markets.mjs` 저장·판매처 연동 Worker. `build.mjs`는 `dist/server/index.js`를 만듭니다. 새 정적 파일은 `build.mjs`의 목록에 추가해야 합니다.
- 서버는 `purchases` 행의 필드를 화이트리스트로 거르지 않지만 값은 검증합니다(단가·부가세는 정수, 벌크는 박스 단위와 총중량 필요).

## 매입관리 (거래명세서 입고)
- 메뉴: 사입업무 → 매입관리, 주소 `#purchaseStatement`.
- PDF를 올리면 품목·수량·단가를 표로 만들고, 반영하면 상품 재고(`products[].units`) 또는 벌크 원물 재고(`purchases` type `bulk`)가 늘어납니다. `statement:true` 표시가 붙은 행이 반영 내역입니다.
- 지원 양식: `순번 품명 규격 단위 수량 단가 금액 세액 합계`(단가는 부가세 포함), 공급자용·공급받는자용 두 부가 있으면 첫 부만 읽습니다. 명세서 합계와 품목 합계가 다르면 경고를 표시합니다.
- 다른 양식은 `public/statement.js`의 `statementLine`에 규칙을 추가하고 실제 PDF로 확인하세요(`pdftotext -layout`으로 글자 배치를 볼 수 있습니다).

## Claude 아티팩트 (휴대폰에서 화면 보기)
- 주소: https://claude.ai/artifact/3Rigwfrnbw5tFjr3aLRPHV (비공개, 소유자만 열람)
- 만들기: `node tools/build-artifact.mjs` → `dist/artifact/marketdesk.html`. 샘플 모드로 고정하고, PDF는 cdnjs의 pdf.js로 페이지 안에서 읽습니다(스캔본 글자 인식 불가).
- 갱신: Artifact 도구로 이 파일을 위 `url`에 다시 게시합니다. 새 URL이 생기지 않게 `url`을 꼭 지정하세요.
- 아티팩트에서는 파일 다운로드, 서버 저장, 외부 API가 동작하지 않습니다.

## 확인 방법
- `node run-local.mjs` 후 `http://127.0.0.1:8787/#화면이름`. Playwright가 설치되어 있어 `require('playwright')`로 캡처할 수 있습니다.
- 테스트용 거래명세서 PDF는 저장소에 없습니다. 필요하면 사용자에게 다시 받으세요.

## 점검 스크립트 (tools/qa)
- `node build.mjs` → `node tools/qa/fake-server.mjs &` (가짜 DB, `http://127.0.0.2:8790`) 후 실행합니다. `/__reset`으로 초기화, `/__db`로 저장된 내용을 확인합니다.
- `node tools/qa/crawl-menus.js <출력폴더> [화면id]`: 모든 메뉴의 버튼을 눌러 저장까지 실행하고 오류를 모읍니다(약 20분).
- `node tools/qa/check-links.js`: 주문, 상품, 사입, 생산, 거래명세서, 재고 내역 등 메뉴 간 연결을 확인합니다.
- 판매처 로그인 등록(암호화 키)과 삭제(비밀번호 0000)는 테스트 환경에서 서버가 거부하는 것이 정상입니다.
