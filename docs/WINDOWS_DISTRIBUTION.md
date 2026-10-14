# Windows 배포

Windows 10/11 x64용 NSIS 설치 파일을 생성합니다. 프로젝트 소스, Node.js,
Rust를 받는 컴퓨터에 설치할 필요가 없습니다. 인터넷은 Claude 연결 도구 다운로드, 번역 로그인·호출과
WebView2가 없는 컴퓨터에서 해당 런타임을 설치할 때 필요합니다.

## 포함 범위

- Paper Vocabulary, PDF.js, 내장 한국어 글꼴.
- 공식 Codex 0.153.4 Windows x64 패키지와 LICENSE/NOTICE.
- 한국어/영어 설치 화면, 현재 사용자 설치, WebView2 자동 설치 설정.
- Claude 구독 연결 기능. Claude 실행 파일은 처음 선택할 때 공식 서버에서 별도 다운로드하며 설치 파일에는 포함하지 않습니다.
- 개인 `.env`, API 키, 로그인 토큰, PDF, SQLite 데이터는 포함하지 않습니다.

설치된 `runtime/bin/codex.exe`를 우선 사용하며, 패키지의 인접 리소스와
manifest 구조를 유지합니다. 인증 정보는 설치 디렉터리가 아닌 사용자 데이터
디렉터리에 저장합니다. 기존 Linux 설치의 런타임 검색도 유지합니다.

## Windows에서 빌드

Node.js 22.13 이상, Rust의 MSVC 도구 체인, Microsoft C++ Build Tools의
`C++를 사용한 데스크톱 개발`, WebView2, Python 3.12 이상을 준비합니다.
Python은 고정된 버전의 배포용 런타임을 준비할 때만 사용합니다.

```powershell
npm ci
python scripts/prepare-windows-runtime.py
npm run tauri build -- --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

출력: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.
Tauri는 Windows 타깃에서 `src-tauri/tauri.windows.conf.json`을 자동 병합합니다.

## 이 Linux 작업 환경에서 다시 빌드

```bash
bash scripts/build-windows.sh
```

현재 `.tools/windows/`에 cargo-xwin 0.23.1, LLVM/Clang/LLD 18, NSIS 3.09,
Windows SDK 캐시를 준비했습니다. 시스템 관리자 권한은 사용하지 않았습니다.
새 Linux 환경에서는 해당 도구와 `x86_64-pc-windows-msvc` Rust 타깃을
준비한 뒤 같은 스크립트를 실행합니다. `.tools/`는 배포 대상이 아닙니다.

`prepare-windows-runtime.py`는 공식 릴리스 아카이브의 고정 SHA-256을 검증하고
Windows 리소스 디렉터리를 생성합니다. Tauri 리소스는 이 디렉터리만 포함합니다.

## 설치와 데이터

설치 파일을 실행한 뒤 앱에서 `번역 연결 → ChatGPT 구독 → ChatGPT 로그인`을
선택합니다. 계정 로그인은 각 사용자가 직접 진행합니다. API 방식은 사용자
데이터 폴더에 개인 `.env`를 설정하고 앱을 재시작합니다.

기본 데이터 폴더:
`%LOCALAPPDATA%\com.papervocabulary.reader\PaperVocabulary`.
기존 Linux의 논문·단어장·하이라이트는 자동 이전하지 않습니다. 데이터 이전 시
앱을 닫고 DB와 PDF 사본을 함께 백업한 뒤 DB의 PDF 절대 경로를 갱신해야 합니다.

Windows 시스템 인쇄는 앱에서 직접 호출하지 않습니다. 단어장을 PDF로 저장한
후 Windows PDF 뷰어에서 인쇄합니다.

## 기존 설치 위에 업데이트

앱을 종료하고 새 설치 파일을 실행하면 됩니다. 같은 설치 경로의 **기존 프로그램 위에 덮어쓰기 (데이터 유지)**를 선택하면 프로그램 파일을 갱신합니다. **기존 프로그램 제거 후 새 버전 설치**는 프로그램을 제거한 뒤 설치를 계속합니다. 제거 확인창의 **저장 데이터도 삭제**는 논문·채팅·단어장·로그인까지 지우는 별도 선택이므로 기록을 유지하는 업데이트에서는 선택하지 않습니다.

GitHub 태그만 바꿔서는 설치 파일의 버전이 바뀌지 않습니다. `package.json`, 잠금 파일, Cargo와 Tauri 설정을 모두 `0.1.1`로 맞췄고 빌드 시 불일치를 검사합니다. 앱 왼쪽 위와 창 제목에 실행 중인 버전을 표시합니다. Windows 설치는 파일 덮어쓰기를 명시하고 복사된 앱 실행 파일의 버전이 설치 입력과 같은지 검사하며, 다르면 설치 성공으로 넘기지 않습니다. 사용자 데이터나 WebView 저장소를 초기화하는 방식은 사용하지 않습니다.

덮어쓰기 뒤에도 예전 버전이 표시되면 실행 중이던 창을 닫고 설치한 경로의 앱을 다시 실행합니다. 다른 경로에 있는 이전 설치나 복사한 EXE의 바로가기를 열고 있는지도 확인합니다. Windows에서 실제 덮어 설치와 잠긴 실행 파일 상황은 별도 Windows 환경에서 검증해야 합니다. 빌드·설치 스크립트 검사만으로 해당 증상을 재현했다고 보지 않습니다.

## Claude 구독 연결

번역 연결에서 **Claude 구독**을 선택하거나 논문 채팅의 **채팅 연결 → Claude 구독**을 선택합니다.
Claude Code가 없으면 **Claude 연결 도구 설치**를 누른 뒤 **Claude 로그인**으로 운영체제의 기본 브라우저에서 로그인합니다.
이미 설치된 네이티브 Claude Code도 검색합니다. 오래된 도구로 연결되지 않으면 **Claude 연결 도구 복구**를 사용합니다.
번역과 채팅의 공급자, 모델, effort는 각각 저장되며 GPT 설정도 유지합니다.
모델과 지원 effort 목록은 실제 Claude CLI 초기화 응답에서 읽어옵니다. 목록에 있는 모델의 계정 사용 권한은 실제 요청에서 확인됩니다.
저장된 번역은 공급자를 바꿔도 재사용하며 새 요청부터 선택한 모델을 사용합니다.

공식 `claude -p`의 스트리밍 입출력을 사용하고 API 키·OAuth 토큰을 직접 읽거나 재사용하지 않습니다.
인증은 앱 데이터 폴더의 `claude/config` 아래에서 공식 CLI가 관리합니다.
도구·MCP·사용자 스킬·프로젝트 설정·세션 기록은 비활성화하고, 채팅 기록은 기존 SQLite에 저장합니다.
쉘/파일/웹 도구를 요청하는 응답은 중단하며 앱 종료와 답변 중단 시 실행 중인 연결 프로세스를 정리합니다.
Claude의 답변 중 추가 질문은 한 개씩 이어서 처리합니다.
채팅창 아래에 공식 CLI의 `get_usage` 제어 요청으로 조회한 5시간·7일 잔여 비율을 표시합니다.
계정이 제공하면 모델별/연결 앱별 주간 한도도 표시하며, 초기화 시각은 비율에 마우스를 올려 확인합니다.
30초마다, 답변 완료 후, 연결 상태 변경 시 갱신하며 수동 새로고침도 지원합니다. 이 조회는 추론을 요청하지 않습니다.
조회 실패 시 마지막 값과 실패 안내를 함께 표시하고, 제공되지 않는 값은 추정하지 않습니다.

로그인 때 CLI의 `BROWSER` 요청을 앱의 전용 시작 경로로 전달합니다. 터미널에 인쇄되는 수동 코드 입력 URL 대신
공식 CLI가 생성한 localhost 콜백 URL을 사용합니다. 주소는 비공개 임시 파일로 전달하고 즉시 제거합니다.
Windows는 `ShellExecuteW`, Linux는 시스템 `gio open`(없으면 `xdg-open`), macOS는 `/usr/bin/open`으로
기본 HTTPS 브라우저를 엽니다. 개발 환경의 브라우저 override나 앱 내 웹뷰를 사용하지 않습니다.

연결 도구는 Claude Code 2.1.241을 고정합니다. 공식 배포 manifest의 크기와 SHA-256을
`src-tauri/claude-runtime.json`에 기록했고 다운로드 완료 후 검증한 파일만 실행 경로에 설치합니다.
Windows x64 다운로드는 약 338MB이며 설치 파일 크기와 별도입니다.

## 검증 범위

2026-10-08 Claude 기본 브라우저 로그인과 구독 잔여 비율 표시를 반영한 Windows x64 설치 파일을 생성했습니다.
`release/windows/PaperVocabulary-0.1.0-Windows-x64-Setup.exe`의 정확한 크기, SHA-256,
빌드 시각은 같은 폴더의 `verification.json` 및 `SHA256SUMS.txt`에 기록합니다.
앱 버전 표기는 0.1.0이며 데이터베이스는 v15입니다.

- 프런트엔드 단위 테스트 75개, Rust 테스트 106개, 관련 화면 테스트 21개 통과.
- 공식 Claude CLI의 계정·추론 없는 초기화/모델 목록 및 `get_usage` 요청 확인 통과.
- 공식 CLI가 실제 앱 실행 파일과 AppImage에 자동 로그인 URL을 전달하는 경로 확인(인증 완료·추론 없음).
- 공식 Claude 연결 도구 다운로드·체크섬 검증·실행·재사용 확인 통과.
- Linux WebKitGTK 실행 및 격리된 데이터베이스 v15 초기화 확인 통과.
- Windows x64 릴리스 빌드와 NSIS 설치 파일 생성, 패키지 압축 무결성 확인 통과.
- 포함된 Codex 리소스와 앱 본체를 빌드 입력과 대조합니다. 앱의 Tauri NSIS 식별자 변경 외 바이트는 동일합니다.
- 개인 설정, 인증 정보, DB, PDF가 설치 파일에 포함되지 않았음을 확인합니다.

실제 Claude 계정 로그인·답변 요청 및 실제 Windows 설치·실행은 아직 검증하지 못했습니다.
자동 테스트에서는 모의 공급자를 사용했으며 실제 계정 사용량은 소비하지 않았습니다.
코드 서명 인증서는 설정하지 않았으므로 Windows 설치 파일은 미서명입니다.

## 참고

- [Tauri Windows 설치 파일](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri 개발 환경](https://v2.tauri.app/start/prerequisites/)
- [OpenAI 공식 Codex CLI 문서](https://learn.chatgpt.com/docs/codex/cli)
- [OpenAI 공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)

- [Claude 구독과 Agent SDK 사용 안내](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Claude CLI 옵션](https://code.claude.com/docs/en/cli-reference)
