# Phase 3 보완 구현 및 검증

2026-09-23. 인쇄 미리보기·시스템 인쇄를 구현했습니다. 후속 요청에 따라 New / Learning / Known 학습 상태 기능을 제거하고 인쇄의 뜻을 오른쪽 정렬했습니다. Action Bubble의 `⋯`를 제거했으며 발음은 제외했습니다. 기존 PDF 내보내기, Vocabulary 삭제, Highlight만 삭제하는 동작은 유지합니다.

## 인쇄와 PDF

Vocabulary의 `인쇄 미리보기`를 누르면 현재 검색·논문 필터와 표시 순서를 복사해 미리보기를 엽니다. Simple Print / Detailed Print를 전환하고 이전·다음 페이지로 실제 A4 결과를 확인할 수 있습니다. 체크박스는 기존처럼 삭제 대상을 선택하며 출력 범위를 변경하지 않습니다.

- Simple: 기존 A4 2단 레이아웃과 9pt 글꼴을 재사용합니다. 영어 단어와 한국어 뜻을 중심으로 배치하며 짧은 한 줄 항목 기준 한 페이지에 62개가 들어갑니다. 한국어 뜻은 각 단의 오른쪽 끝에 정렬하며 긴 뜻도 줄마다 오른쪽 정렬합니다. 긴 텍스트는 줄바꿈합니다.
- Detailed: 기존 단어·뜻·설명·원문 문장·논문명·페이지·조회 횟수 구성을 유지하고 모든 해당 문맥을 출력합니다. 뜻은 본문 오른쪽 끝에 정렬하고 설명·원문 문장 등은 기존 왼쪽 정렬을 유지합니다. 긴 내용은 다음 페이지로 이어집니다.
- 미리보기, `PDF 저장`, `시스템 인쇄`는 동일한 PDF 바이트를 사용합니다. 화면 확대·축소는 A4 출력 크기에 영향을 주지 않습니다. 한글 글꼴을 내장합니다.
- Linux에서는 GTK의 시스템 인쇄 대화상자에 프린터·페이지 범위·매수 선택을 맡깁니다. Poppler/Cairo로 PDF를 벡터 출력하므로 화면 미리보기 해상도로 인쇄하지 않습니다. 기본 용지는 A4 세로이며 PDF 자체 여백을 사용합니다.
- 다른 운영체제의 직접 시스템 인쇄는 구현·검증하지 않았습니다. 해당 환경에서는 PDF 저장 후 시스템 PDF 뷰어에서 인쇄하라는 안내를 표시합니다.
- 취소하면 완료 메시지를 표시하지 않습니다. 인쇄·저장 중에는 중복 제출과 형식 전환·닫기를 막습니다. 실패하면 메시지와 다시 시도를 제공합니다. 미리보기를 닫으면 원래 버튼으로 키보드 초점을 돌립니다.

기존 `PDF 내보내기` 버튼도 유지합니다. `PrintPreview`와 PDF 생성 코드는 요청할 때 불러오며, 미리보기에서 현재 페이지 Canvas 하나만 사용합니다. 닫기·형식 전환 시 PDF.js 작업을 정리하고 Reader의 Canvas/Text Layer, 배율, 스크롤 위치와 캐시는 그대로 유지합니다.

## 학습 상태 제거와 기존 데이터

후속 요청으로 Simple/Detailed의 학습 상태 선택, 상태 변경 IPC 명령, 백엔드 갱신 메서드와 상태 응답 필드를 제거했습니다. Vocabulary는 단어·뜻·문맥과 기존 선택·삭제·검색·필터·확대 기능을 유지합니다.

기존 DB의 `vocabulary_entries.status` 열은 호환성을 위해 사용하지 않는 상태로 남겨 두었습니다. DB 버전 8과 기존 저장 내용을 유지하며, 열 삭제나 DB 재작성은 하지 않습니다. 조회 횟수·Context·Highlight·API Cache·비용 기록을 바꾸지 않습니다.

## 자동 검증

전체 **159개 통과**: Vitest 41개, Rust 41개, Playwright 77개. 제거한 학습 상태 전용 테스트를 정리하고 두 출력 형식의 실제 PDF 좌표 정렬과 학습 상태 UI 제거를 검증했습니다.

- Simple/Detailed의 짧은 뜻·여러 줄의 긴 뜻·뜻 없음 표시가 각 단/본문 오른쪽 끝에 정렬되는지 실제 PDF.js 텍스트 좌표로 검사합니다. 여러 단과 페이지에 걸친 내용 보존·A4 여백·영어 단어와 설명의 기존 왼쪽 정렬도 확인합니다.
- 학습 상태 선택 UI와 호출 제거, 두 보기의 단어 선택과 한국어 뜻 유지, 좁은 창과 확대 시 배치.
- 실제 PDF.js 미리보기, A4 크기, 현재 필터와 섞인 순서, Simple/Detailed 내용, 페이지 이동 시 Canvas 하나 유지, 저장과 인쇄 전달 바이트 일치.
- 인쇄 취소·실패·중복 제출 차단, PDF 저장 취소, 글꼴 로딩 실패·재시도, 빠른 형식 전환·진행 중 닫기·포커스 복원.
- 기존 PDF 열기/드롭, 선택·더블클릭·드래그·삼중 클릭·하이픈 단어, 번역/설명·Cache·SQLite·Highlight 복원과 삭제, Bubble·Zoom·너비 맞춤·Ctrl+휠, Library·메모·이동 기록 회귀.
- 미리보기 왕복 시 동일 Reader Canvas/Text Layer 객체와 PDF 읽기 횟수를 유지합니다. 기존 Reader 렌더 큐·가시 영역 판단·DPR/메모리 상한·스크롤 보간 설정은 변경하지 않았습니다. 이번 작업에서 새 성능 수치를 주장하지 않습니다.

TypeScript/Vite, Rust fmt/Clippy 및 Tauri 릴리스 빌드를 완료했습니다. DEB/RPM/AppImage를 생성하고 DEB/RPM에 Poppler GLib 런타임 의존성을 선언했습니다. AppImage에는 Poppler 라이브러리와 GTK 인쇄 백엔드가 포함됩니다. 기존 Vite의 큰 청크 경고는 남아 있으나 빌드는 통과합니다.

```bash
source .tools/env.sh
npm test
OPENAI_API_KEY= npm run test:rust
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
OPENAI_API_KEY= npm run tauri build -- --no-bundle
PKG_CONFIG_PATH="$PWD/.tools/bundle-pkgconfig:$PKG_CONFIG_PATH" APPIMAGE_EXTRACT_AND_RUN=1 OPENAI_API_KEY= npm run tauri bundle
```

Linux 개발 환경에는 `libpoppler-glib-dev`가 추가로 필요합니다. 이 작업 환경은 `.tools/native`에 개발용 파일을 준비했고 시스템 패키지나 실제 사용자 DB는 변경하지 않았습니다.

## 실제 Linux 앱과 A4 출력 확인

초기 인쇄 구현 때 별도 Xvfb 화면과 별도 XDG 데이터 폴더에서 실제 Tauri 앱을 실행했습니다. 실제 API 키는 사용하지 않았습니다. 테스트 단어 81개로 Native 미리보기, 시스템 인쇄 대화상자, PDF 저장과 인쇄 취소를 확인했습니다.

시스템 대화상자의 **Print to File만** 사용하여 Simple 2페이지와 Detailed 25페이지를 A4 PDF로 출력했습니다. 같은 미리보기에서 직접 저장한 PDF와 비교해 모든 페이지의 텍스트가 일치하고 내용이 페이지 여백 안에 들어가는지 검사했습니다. 모든 페이지를 Poppler로 이미지로 렌더링해 한글·2단 배치·페이지 경계도 시각적으로 확인했습니다. 실제 물리 프린터로 종이를 출력하는 테스트는 하지 않았습니다.

초기 인쇄 구현 때 AppImage로 재실행해 Simple 미리보기의 2페이지에서 시스템 인쇄의 `Current Page`로 파일 출력한 결과는 A4 1페이지이며 원본의 2페이지 내용과 일치했습니다. 이 재실행·미리보기·인쇄 과정 전후의 SQLite 전체 덤프도 동일했습니다.

후속 오른쪽 정렬 수정 후 Simple 4페이지와 Detailed 3페이지의 긴 뜻을 포함한 PDF를 생성해 모든 페이지를 이미지로 확인했습니다. 실제 텍스트 좌표 검증에서도 각 단/본문의 오른쪽 끝과 일치하고 페이지 여백을 유지했습니다. 새 AppImage에서는 과거 Known/Learning 값이 남아 있는 테스트 DB를 열어 학습 상태 UI가 제거된 Vocabulary와 두 형식의 정렬된 미리보기를 확인했습니다. 실행·열람·미리보기 전후 SQLite 전체 덤프가 같고 무결성·외래 키 검사도 통과했습니다. 시스템 인쇄 전달 코드와 Reader 렌더링 코드는 이번 수정에서 변경하지 않았습니다.

초기 인쇄 구현의 로그는 `.tools/phase3-verification/`, 학습 상태 제거 및 오른쪽 정렬의 테스트 로그·PDF·검증 이미지는 `.tools/print-alignment-verification/`에 있습니다. 자동 테스트의 인쇄 IPC 대역 검증과 실제 GTK 파일 출력 검증을 구분해 기록했습니다.
