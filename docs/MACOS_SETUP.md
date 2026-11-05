# macOS 소스 빌드와 사용

[프로젝트 소개로 돌아가기](../README.md)

macOS는 소스 빌드로 사용할 수 있습니다. Apple Silicon의 macOS 26.6에서 앱 빌드·실행, PDF 표시와 앱 재시작 후 Library 문서 복원을 확인했습니다. Intel용 공식 연결 도구도 준비하지만, Intel Mac의 앱 빌드·실행은 아직 검증하지 않았습니다. 실제 계정의 AI 번역·채팅 요청도 별도 검증이 필요합니다.

## 개발 도구 준비

- [Node.js](https://nodejs.org/en/download) 22.13 이상. 테스트까지 실행하려면 Node.js 24 LTS를 권장합니다.
- [Rust](https://rust-lang.org/tools/install/) 1.88 이상과 Cargo.
- [Python](https://www.python.org/downloads/macos/) 3.12 이상. `python3` 명령이 이 버전을 가리켜야 합니다.
- Git과 Xcode Command Line Tools. 데스크톱 빌드에는 전체 Xcode 대신 Command Line Tools를 사용할 수 있습니다.

```bash
xcode-select --install
node --version
cargo --version
python3 --version
xcrun --show-sdk-path
```

자세한 운영체제 준비는 [Tauri의 macOS 안내](https://v2.tauri.app/start/prerequisites/#macos)를 참고하세요. 설치한 도구가 현재 터미널의 `PATH`에 있어야 합니다.

## 앱 빌드

이 변경이 포함된 체크아웃에서 실행합니다.

```bash
git clone https://github.com/Bongjin-Shin/paper-reader.git
cd paper-reader
npm ci
bash scripts/build-macos.sh
```

빌드 스크립트는 다음 작업을 수행합니다.

1. Rust의 네이티브 호스트에 맞는 공식 Codex 0.153.4 패키지를 내려받습니다. Apple Silicon은 `aarch64-apple-darwin`, Intel은 `x86_64-apple-darwin`입니다.
2. 릴리스 아카이브의 고정 SHA-256, 패키지 버전·타깃, Mach-O 아키텍처와 실행 권한을 확인합니다. 아카이브는 경로 이탈을 제한하는 방식으로 압축 해제합니다.
3. 공개 실행 파일·리소스·라이선스만 `src-tauri/resources/macos/codex/`에 준비하고 앱의 `Contents/Resources/runtime/`에 포함합니다. 기존 Codex·Claude 인증 파일이나 앱 데이터는 읽거나 복사하지 않습니다.
4. `Cargo.lock`을 고정한 Tauri `.app`을 생성합니다. Finder 메타데이터 중 서명을 방해하는 `FinderInfo`·`ResourceFork`만 제거하고, 앱에 로컬 ad-hoc 서명을 적용한 뒤 검증합니다. 내장 공식 실행 파일의 서명과 entitlement는 유지합니다.

기본 결과물:

```text
src-tauri/target/release/bundle/macos/Paper Vocabulary.app
```

`CARGO_TARGET_DIR`을 사용하는 경우 실제 출력 경로를 완료 메시지에서 확인하세요. 이 스크립트는 네이티브 빌드를 대상으로 하므로 `CARGO_BUILD_TARGET`은 해제합니다. Developer ID로 배포할 때는 아래의 배포 범위를 참고하세요.

생성되는 `.tools/` 캐시와 macOS 런타임 리소스는 Git에서 제외합니다. 검증 실패 시 기존에 준비된 런타임은 교체하지 않습니다. 체크섬 오류가 나면 오류에 표시된 캐시 아카이브를 제거한 뒤 다시 실행하세요.

## 실행·설치·업데이트

기본 출력 경로의 앱은 다음과 같이 실행합니다.

```bash
open "src-tauri/target/release/bundle/macos/Paper Vocabulary.app"
```

설치하려면 앱을 종료한 뒤 생성된 `.app`을 Finder에서 **응용 프로그램** 또는 **홈 폴더의 Applications**로 옮깁니다. 업데이트할 때는 Finder의 앱 교체 기능을 사용합니다. 설치된 앱 실행에는 Node.js·Rust·Python이 필요하지 않습니다.

앱의 **PDF 열기** 또는 **Library → PDF 추가**로 선택 가능한 텍스트가 있는 PDF를 추가하세요. 스캔 PDF의 OCR은 지원하지 않습니다.

개발 중에는 다음 명령을 사용할 수 있습니다. 내장 Codex 리소스를 처음 준비하려면 먼저 빌드 스크립트를 한 번 실행하세요.

```bash
npm run tauri dev -- --config src-tauri/tauri.macos.conf.json
```

## AI 연결과 저장 위치

**번역 연결**에서 ChatGPT 구독 또는 Claude 구독을 선택하고 본인 계정으로 로그인합니다. 로그인은 사용자가 브라우저에서 완료합니다. ChatGPT 연결 도구는 앱 안에 포함되어 Finder 실행 시에도 터미널의 Node.js·Codex 경로에 의존하지 않습니다. Claude 연결 도구는 앱에서 설치할 수 있습니다.

OpenAI API 방식을 사용하는 경우의 키 설정과 비용은 [프로젝트 안내](../README.md#ai-연결과-데이터)와 [ChatGPT 연결 안내](CHATGPT_CONNECTION.md)를 참고하세요. 개인 키·토큰·인증 파일은 빌드 리소스나 PR에 포함하지 않습니다.

macOS의 앱 데이터 위치:

```text
~/Library/Application Support/com.papervocabulary.reader/PaperVocabulary/
```

이 폴더에 논문 사본, SQLite 데이터베이스, 캐시, 앱 전용 AI 인증 설정을 보관합니다. `.app` 교체와 데이터 폴더는 별개입니다. 백업이 필요하면 앱을 종료한 뒤 이 폴더를 별도로 보관하세요.

현재 macOS의 직접 시스템 인쇄 대신 **Vocabulary에서 PDF로 저장 → 미리보기에서 인쇄**를 사용합니다.

## PDF 표시 호환성

일부 시스템 WKWebView에는 `ReadableStream.prototype.values`와 `[Symbol.asyncIterator]`가 없습니다. PDF.js의 텍스트 추출은 `for await`를 사용하므로 이 환경에서는 앱이 열려도 PDF 표시가 실패할 수 있습니다.

앱은 빠진 스트림 반복 기능을 보완하며 기존 네이티브 구현은 유지합니다. 반복 완료·중단·오류 시 reader lock을 해제합니다. PDF.js 본체와 worker도 같은 버전의 호환 빌드를 사용합니다.

## 검증

```bash
python3 tests/macos-runtime.py
npm test -- --maxWorkers=2
npx playwright install webkit
npm run test:e2e -- tests/e2e/pdf-compatibility.spec.ts tests/e2e/reader.spec.ts --browser=webkit --workers=1
bash scripts/build-macos.sh
```

2026-11-05 Apple Silicon / macOS 26.6 확인 내용:

- Node.js 24.22.2, Rust 1.99.1, Python 3.14.5 사용.
- 런타임 준비 테스트 7개 통과. 체크섬·패키지 정보·아키텍처 불일치와 아카이브 경로 이탈을 검사합니다.
- 공용 `scripts/build-macos.sh`로 arm64 앱을 생성하고 앱 서명과 내장 Codex 0.153.4를 검증했습니다.
- 프런트엔드 테스트 126개와 WebKit PDF 화면 테스트 10개 통과. 화면 테스트는 실제 PDF.js와 테스트용 Tauri IPC를 사용합니다.
- 실제 시스템 WKWebView에서 누락된 스트림 API를 확인하고, 실제 설치 앱에서 샘플 PDF 표시와 앱 재시작 후 Library 문서 복원을 확인했습니다.
- 실제 구독 로그인·AI 호출, Intel Mac 실기 실행, Windows·Ubuntu 패키지 재빌드는 검증 범위에 포함하지 않았습니다.

공식 서명·공증이 적용된 macOS 설치 파일이나 DMG 배포는 아직 제공하지 않습니다. 이 빌드 스크립트는 로컬 사용을 위한 ad-hoc 서명 앱을 만듭니다. 공식 배포는 유지 관리자가 별도로 [Developer ID 서명과 공증](https://v2.tauri.app/distribute/sign/macos/)을 준비해야 합니다. 시스템 보안 설정을 변경하는 단계는 없습니다.
