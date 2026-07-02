# Chrome Extension Content Bot

Slack에서 메시지를 주고받고, 다음 단계에서 README를 OpenAI로 구조화 JSON으로 변환하기 위한 Node.js/TypeScript 서버입니다.

## 현재 구현 범위

- Slack Events API endpoint: `POST /api/slack/events`
- Slack URL verification challenge 응답
- Slack `app_mention` 이벤트에 thread reply 전송
- Slack request signature 검증
- OpenAI README -> extension draft JSON 생성 함수
- Zod 기반 extension draft 검증
- OpenAI 연결/구조화 출력 확인 CLI
- GitHub PR 생성

README 파일 업로드 처리는 아직 연결하지 않았습니다.

## 실행

```bash
npm install
cp .env.example .env
PORT=3100 npm run dev
```

서버 확인:

```bash
curl http://localhost:3100/health
```

## Slack 연결 확인

로컬 서버를 Slack에서 호출하려면 공개 HTTPS URL이 필요합니다.

예:

```bash
ngrok http 3100
```

Slack App 설정:

- Event Subscriptions Request URL: `https://YOUR-NGROK-DOMAIN/api/slack/events`
- Subscribe to bot events: `app_mention`
- OAuth scope: `chat:write`

Slack에서 봇을 채널에 초대한 뒤:

```text
@bot ping
```

정상 연결 시 봇이 같은 thread에 다음 메시지를 보냅니다.

```text
연결 확인 완료: README를 보내주면 다음 단계에서 구조화 데이터를 만들게요.
```

README 구조화 preview 생성:

```text
@bot generate
# My Chrome Extension

README 내용...
```

현재 thread의 draft에 URL 추가:

```text
@bot add_github https://github.com/owner/repo
@bot add_chrome https://chromewebstore.google.com/detail/...
```

현재 thread의 draft URL 덮어쓰기:

```text
@bot edit_github https://github.com/owner/repo
@bot edit_chrome https://chromewebstore.google.com/detail/...
```

현재 thread의 draft category 보완:

```text
@bot add_category Automation Tool
@bot edit_category Productivity
```

현재 draft 다시 보기:

```text
@bot preview
```

최종 schema 검증 후 승인:

```text
@bot approve
```

`approve`가 성공하면 GitHub branch를 만들고 `data/extensions.json`에 현재 draft를 append한 뒤 pull request를 생성합니다.

배포 health URL 확인:

```text
@bot health
```

응답에는 현재 요청 기준으로 확인한 `/health` URL이 포함됩니다.

명령어 확인:

```text
@bot /h
```

`add_github`, `add_chrome`, `add_category`는 기존 값이 비어 있을 때만 추가합니다. 이미 값이 있으면 현재 값을 알려주고 덮어쓰지 않습니다. 덮어쓰기는 `edit_github`, `edit_chrome`, `edit_category`를 사용합니다.

## GitHub PR 생성 설정

`.env`에 아래 값을 넣어야 `approve`가 PR을 만들 수 있습니다.

```env
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=doh-kim-chrome-extensions
GITHUB_BASE_BRANCH=main
```

GitHub token은 target repo에 대해 contents write와 pull request write 권한이 필요합니다.

## OpenAI 구조화 출력 확인

```bash
npm run check:openai -- /path/to/README.md
```

성공하면 다음 구조의 JSON이 출력됩니다.

```json
{
  "extension": {},
  "missingFields": [],
  "questions": []
}
```

출력은 Zod schema를 통과해야만 콘솔에 표시됩니다.

## 검증

```bash
npm test
npm run build
```
