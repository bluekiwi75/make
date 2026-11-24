# 마켓데스크 작업 인계 (Claude용)

휴대폰이나 다른 세션에서 이어받을 때 이 문서를 먼저 읽으세요. 처음 인계 내용은 `README-CLAUDE.md`에 있습니다.

## 작업 규칙 (사용자 요청)
- 한국어로 답하고, 결과는 짧게 정리합니다. 확인용 서버는 "가짜 서버"가 아니라 "테스트 서버"라고 부릅니다(사용자 지시).
- 사용자가 명령할 때마다 `WORK_COUNT.md`의 번호를 1 올립니다. 작업이 끝나면 답변 맨 끝에 `작업 #번호 · 2026-11-22 14:30 KST`처럼 번호와 날짜·시간(`TZ=Asia/Seoul date`로 확인)을 표시합니다. 파일의 번호와 표도 갱신해 같은 커밋에 넣습니다.
- 작업이 끝날 때마다 마켓데스크 화면 캡처를 `SendUserFile`로 보내고, `PushNotification`으로 알림을 보냅니다.
- 알림은 사용자가 다른 일을 하다가 알 수 있게 하려는 것입니다. 모든 작업의 맨 마지막에 `PushNotification`을 보내고(제목은 `작업 #번호 완료: 결과 한 줄`), 알림음은 사용자 기기의 Claude 앱 알림 설정에 따릅니다(이 환경에서는 소리를 직접 낼 수 없음).
- 작업이 끝나면 아티팩트를 갱신하고 링크(https://claude.ai/artifact/3Rigwfrnbw5tFjr3aLRPHV)를 답변에 꼭 포함합니다. 사용자가 휴대폰에서 화면을 확인합니다.
- 개발 브랜치는 `claude/funny-wozniak-rt4sh9`입니다. 커밋하고 이 브랜치에 푸시합니다. PR은 요청이 있을 때만 만듭니다.
- 이 저장소에서 만드는 사이트가 운영 사이트입니다(사용자 지시). 다른 운영 사이트로의 배포는 고려하지 않으며, 답변에 "운영 사이트에 반영되지 않았다"는 안내도 붙이지 않습니다. 원래 ChatGPT Sites 사이트에는 접근하지 않습니다.
- 확인은 샘플 모드(`node run-local.mjs`, 8787 포트)와 `tools/qa`의 가짜 DB 서버에서 합니다.
- 조회 기간 기본값은 이번 달 1일 ~ 오늘이며 `1주일/1개월/3개월/6개월/전체 기간` 버튼이 있습니다.

## 로드맵 아티팩트
- 주소: https://claude.ai/artifact/MkxnZ8tSxoDmy9e6uheaGN, 원본 `docs/roadmap.html`. 한 일, 해야 할 일, 메뉴 지도를 담고 있습니다.
- 작업을 마칠 때 `DONE`(한 일)과 `TODO`(해야 할 일) 배열, 기준 시각, 최근 작업 번호를 고치고 위 `url`로 다시 게시합니다.
- 맨 위 탭으로 영역을 나눕니다: `order`(주문·API), `purchase`(사입·재고), `recipe`(레시피·원가), `schedule`(스케줄), `system`(저장·운영), `cleanup`(메뉴 정리: 없어도 되는 메뉴 후보 `REMOVE`와 `a`에 `cleanup`을 넣은 추가 제안). `TODO` 항목은 `a:["order"]`처럼 영역을 꼭 지정하고, `DONE` 항목은 네 번째 값에 영역 배열을 넣습니다(여러 영역 가능). 탭 주소는 `#order` 형식입니다. 새 메뉴 그룹은 `MENU_AREAS`에 영역을 지정합니다.

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

## 제품 레시피 (엑셀과 같은 항목)
- 목록, 등록·수정 폼, 엑셀 다운로드, 엑셀 가져오기가 모두 같은 8개 항목입니다: `제품명`, `재료·배합`, `원물 차감 기준 단위`, `원물 차감 기준 (g)`, `자동 기준 포장 규격`, `자동 기준 1턴 원물 필요량 (g)`, `수동 기준 포장 규격`, `수동 기준 1턴 원물 필요량 (g)`(`recipeColumns`).
- 저장 필드: `name`, `detail`, `unit`, `materials`(`원물명 100 g` 줄을 `{name,grams}`로), `autoPack`, `autoNeeds`, `manualPack`, `manualNeeds`. `note`(작업 방법)는 서버에서 선택 항목입니다. 재료·배합을 비워 두면 원물 차감 기준에서 자동 작성합니다.
- 엑셀 가져오기(`importRecipeWorkbook`): 같은 제품명은 갱신, 없으면 신규 등록하고, 원가시트(`costSheet`)의 레시피는 건드리지 않습니다. 엑셀 다운로드(`exportRecipes`)와 왕복해도 값이 같습니다(시트명 `마켓데스크`).
- `1턴 원물 필요량`은 원래 앱이 포장 단위로 계산하던 값이라 이 앱은 계산하지 않고 입력·보관만 합니다.

## Claude 아티팩트 = 운영 사이트 (휴대폰에서 사용)
- 주소: https://claude.ai/artifact/3Rigwfrnbw5tFjr3aLRPHV (비공개, 소유자만 열람). 데이터는 아티팩트 `db`의 `state` 컬렉션에 저장됩니다(규칙: 읽기·쓰기 admin 이상). **`state` 문서를 지우거나 덮어쓰지 마세요.**
- 저장 구조(format 2): 페이지 안에서 `worker.mjs`가 그대로 돌며 검증하고(`tools/artifact-persist.js`가 `/api/state`를 가로챔), D1 표(market_state)를 아티팩트 db에 나눠 저장합니다. 사업자 1은 `state/b1`(메타: format, revision, businessName, parts[{id,key,hash}])과 `state/b1-<조각id>`(내용 `{text}`, 문서당 150KB 이하), 사업자 2는 `b2`입니다. 주문(`orders`)은 주문일의 월별로 `orders-YYYY-MM-N` 조각에 나누고, 나머지 항목(원가시트·레시피·상품·사입·스케줄 등)은 항목마다 따로 저장합니다. 내용이 바뀐 조각만 쓰고(해시 비교) 안 쓰는 조각은 지웁니다. 이전 형식(format 1, `b1-0…`)도 읽고, 첫 저장 때 새 형식으로 바꿉니다.
- 용량: 문서 하나 256KiB, 아티팩트 db 문서 25,000개. 주문 20,000건(약 8MB)까지 저장·복원을 확인했습니다. 서버 검증 한도는 주문 200,000건, 요청 60MB이고 엑셀 가져오기는 한 파일 50,000행까지입니다. 주문 목록은 500건씩 표시합니다(`orders-more`).
- 만들기: `node tools/build-artifact.mjs` → `dist/artifact/marketdesk.html`(저장 모드). `--demo`를 붙이면 샘플 데이터로 고정한 체험용(저장 안 됨)이 됩니다.
- 갱신: Artifact 도구로 이 파일을 위 `url`에 다시 게시하고, `capabilities`는 `{"db":{"rules":[{"path":"state","read":"admin","write":"admin"}]}}`를 그대로 넘깁니다. 코드를 다시 게시해도 저장된 데이터는 유지됩니다.
- 데이터를 직접 넣거나 확인할 때는 `ArtifactData`로 `state` 컬렉션을 읽습니다. 처음 데이터는 `tools/qa/fake-server.mjs`(`/__empty`)에서 원가시트·제품 레시피를 가져와 만든 내용을 위 형식으로 넣었습니다.
- 이 사이트에서 쓸 수 없는 것: 사입 원본 파일 보관(`/api/purchase-document`), 파일 다운로드. 거래명세서 PDF 읽기는 페이지 안 pdf.js로 되고 스캔본 글자 인식은 안 됩니다.

## 판매처 API 연동 서버 (bridge/)
- 아티팩트 페이지와 이 작업 환경은 외부 주소로 나갈 수 없어서, API 호출은 `bridge/`의 Cloudflare Worker(MCP 서버)가 맡습니다. 사용자가 이 서버를 배포하고 claude.ai에 커넥터 `마켓데스크 연동`(주소 `…/mcp/<BRIDGE_TOKEN>`)으로 추가해야 작동합니다. 배포 절차는 `bridge/README.md`.
- 역할 분담: 연동 서버는 API 키 암호화 보관(D1)과 판매처 호출(`test`, `fetch`, `dispatch`, `save`, `list`)만 합니다. 주문 저장·병합·송장 전송 뒤 주문 상태 변경은 사이트(`tools/artifact-persist.js`의 `handleMarkets`)가 합니다(`mergeMarketOrders` 재사용).
- 사이트가 부르는 도구는 `market_api` 하나(`claude.use("mcp").callTool("마켓데스크 연동","market_api",…)`)이고, 아티팩트 게시 때 `capabilities`에 `"mcp":{"servers":[{"server":"마켓데스크 연동","tools":["market_api"]}]}`도 함께 넘겨야 합니다.
- 판매자센터 로그인 정보 등록은 사이트 안에서 처리합니다. 암호화 키는 `state/secret`(db)에 있고 소유자만 읽습니다.
- 시험: `node bridge/build.mjs && node tools/qa/bridge-test.mjs`(연동 서버 단독, 가짜 판매처 응답), `node tools/build-artifact.mjs && node tools/qa/site-bridge-test.mjs`(사이트→커넥터→판매처 전체 흐름, 커넥터와 판매처는 가짜). 실제 claude.ai 커넥터와 실제 판매처 API는 시험하지 못했습니다.
- 주의: 쿠팡·네이버가 호출 IP 제한을 요구하면 Cloudflare Workers의 가변 IP는 거절될 수 있습니다.

## 확인 방법
- `node run-local.mjs` 후 `http://127.0.0.1:8787/#화면이름`. Playwright가 설치되어 있어 `require('playwright')`로 캡처할 수 있습니다.
- 테스트용 거래명세서 PDF는 저장소에 없습니다. 필요하면 사용자에게 다시 받으세요.

## 점검 스크립트 (tools/qa)
- `node build.mjs` → `node tools/qa/fake-server.mjs &` (가짜 DB, `http://127.0.0.2:8790`) 후 실행합니다. `/__reset`으로 초기화, `/__db`로 저장된 내용을 확인합니다.
- `node tools/qa/crawl-menus.js <출력폴더> [화면id]`: 모든 메뉴의 버튼을 눌러 저장까지 실행하고 오류를 모읍니다(약 20분).
- `node tools/qa/check-links.js`: 주문, 상품, 사입, 생산, 거래명세서, 재고 내역 등 메뉴 간 연결을 확인합니다.
- 판매처 로그인 등록(암호화 키)과 삭제(비밀번호 0000)는 테스트 환경에서 서버가 거부하는 것이 정상입니다.
