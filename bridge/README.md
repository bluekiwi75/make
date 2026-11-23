# 마켓데스크 연동 서버

쿠팡·네이버·11번가·옥션·지마켓 API를 부르는 작은 서버입니다. 마켓데스크 사이트(claude.ai 아티팩트)는 외부 서버에 직접 접속할 수 없어서, 이 서버를 **claude.ai 커넥터**로 등록하면 사이트가 커넥터를 통해 부릅니다.

- 이 서버가 하는 일: API 키를 암호화해 보관하고, 판매처에서 주문을 가져오고, 네이버에 송장번호를 보냅니다.
- 사이트가 하는 일: 가져온 주문을 저장하고 화면에 보여 줍니다. 주문은 이 서버에 남지 않습니다.
- 사이트가 부르는 도구 이름은 `market_api` 하나이고, 커넥터 이름은 반드시 **`마켓데스크 연동`** 이어야 합니다.

## 배포 (Cloudflare Workers, 컴퓨터 터미널에서 한 번)

Node.js 22 이상과 Cloudflare 계정이 필요합니다. 저장소를 받은 뒤 `bridge` 폴더에서 진행합니다.

```bash
cd bridge
npm install
npx wrangler login
```

1. 데이터베이스를 만들고, 출력된 `database_id`를 `wrangler.toml`의 `REPLACE_WITH_DATABASE_ID` 자리에 넣습니다.

```bash
npx wrangler d1 create marketdesk-bridge
```

2. 표를 만듭니다.

```bash
npx wrangler d1 migrations apply marketdesk-bridge --remote
```

3. 비밀값 두 개를 등록합니다. 첫 번째는 API 키 암호화 키, 두 번째는 커넥터 주소에 들어가는 비밀 토큰입니다. 두 값 모두 안전한 곳에 적어 두세요.

```bash
openssl rand -base64 32
npx wrangler secret put MARKET_CONNECTION_KEY
openssl rand -hex 24
npx wrangler secret put BRIDGE_TOKEN
```

4. 배포합니다.

```bash
npm run deploy
```

배포가 끝나면 `https://marketdesk-bridge.<계정>.workers.dev` 주소가 나옵니다.

## claude.ai에 커넥터 추가

1. claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가
2. 이름: `마켓데스크 연동`
3. 주소: `https://marketdesk-bridge.<계정>.workers.dev/mcp/<BRIDGE_TOKEN 값>`
4. 마켓데스크 사이트를 열면 커넥터 사용을 허용할지 묻습니다. 허용합니다.

주소 끝의 토큰을 아는 사람은 이 서버를 부를 수 있으니 주소를 공유하지 마세요. 바꾸려면 `BRIDGE_TOKEN`을 새로 등록하고 커넥터 주소도 고칩니다.

## 사용

사이트의 판매처 설정 화면에서 판매처별 `API 키 등록` → `연결 확인` → `주문 가져오기`를 합니다. 네이버 주문은 송장번호 전송 화면에서 `네이버에 전송`을 누르면 됩니다.

## 알아둘 점

- **허용 IP:** 쿠팡·네이버는 API 키를 발급할 때 호출 IP를 제한할 수 있습니다. Cloudflare Workers는 나가는 IP가 고정되어 있지 않아서, 판매처가 IP를 등록하라고 하면 `401/403`으로 거절될 수 있습니다. 이 경우에는 고정 IP가 있는 서버에서 같은 코드를 돌려야 합니다.
- **호출 제한:** 판매처마다 하루 조회 건수와 호출 제한이 있습니다(앱이 안내 메시지로 알려 줍니다).
- **키 보관:** API 키는 이 서버의 D1에만 `MARKET_CONNECTION_KEY`로 암호화되어 저장됩니다. 사이트 저장소에는 들어가지 않습니다.
- **시험:** `npm test`는 판매처를 가짜 응답으로 대신해서 서버 동작을 확인합니다. 실제 판매처에는 접속하지 않습니다.
