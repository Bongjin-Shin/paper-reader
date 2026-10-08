# PDF Reader / Vocabulary 추가 사용성 기능

2026-09-22. Phase 2 완료 이후 요청한 7가지만 추가했습니다. 이전 문서의 구·문장 무저장, 결과 말풍선의 스크롤 닫기, PDF Export 미구현 항목은 이 변경으로 대체됩니다.

## 동작

| 요청 | 구현 |
| --- | --- |
| Vocabulary PDF 내보내기 | 현재 검색·논문 필터와 Simple/Detailed 보기를 반영. 시스템 저장 대화상자로 위치 선택 |
| 스크롤 중 말풍선 유지 | 번역/설명을 요청한 뒤에는 진행 중·결과·오류 말풍선을 화면에 유지. ESC, 바깥 클릭, 다른 선택으로 닫기 |
| 드래그 번역 저장 | 선택한 구·문장 전체를 한 항목으로 저장. 원문 문맥, 논문, 시작 페이지, 번역/설명, 조회 횟수 보존 |
| 삼중 클릭 | 브라우저가 선택한 행/문장을 읽어 Action Bubble 표시. 선택만으로 API 호출/저장하지 않음 |
| 하이라이트 취소 | 저장된 Highlight를 클릭하거나 겹치는 텍스트를 선택한 Action Bubble에서 취소. 해당 위치의 표시만 삭제 |
| 5색 선택 | 상단 노랑·초록·파랑·분홍·보라. 새 Highlight에 적용. 각 Highlight 색상과 마지막 선택 색상은 SQLite에 보존 |
| Vocabulary 확대·축소 | 목록을 75~200%로 조절. Reader 배율과 독립적이며 화면 왕복 시 유지 |

취소한 Highlight의 Vocabulary/Context/Lookup Count/Cache/비용 기록은 남습니다. 다시 번역하면 캐시를 사용해 현재 선택 색상으로 Highlight를 생성할 수 있습니다. 이미 존재하는 Highlight는 새로운 기본 색상을 선택해도 원래 색상을 유지합니다.

문장도 정확히 같은 선택 텍스트 + Context + action이면 기존 결과를 재사용합니다. 문장의 대소문자와 줄바꿈을 저장할 때 변경하지 않습니다. 기존 단어의 대소문자/아포스트로피 정규화는 유지합니다. 문장 저장은 번역과 설명 모두에 적용하며, 구·문장 자동 Highlight 생성은 기존과 같이 수행하지 않습니다.

아직 번역/설명을 실행하지 않은 Action Bubble은 기존처럼 40px 이상 스크롤하면 닫힙니다. 실행 이후의 말풍선은 화면에 고정되어 스크롤마다 React state나 위치 계산을 갱신하지 않습니다.

## PDF 출력

- Simple: A4 2단, 영어 텍스트와 한국어 뜻.
- Detailed: 모든 문맥의 뜻, 설명, 원문, 논문/페이지 및 조회 횟수.
- 긴 단어·문장과 문맥은 줄바꿈하고 다음 단/페이지로 이어집니다. 제목·쪽번호와 여백을 유지합니다.
- 한글/영문 Nanum Gothic 글꼴을 포함하므로 시스템에 해당 글꼴이 없어도 표시됩니다. 글꼴 서브셋에서 복합 글리프가 누락되는 문제를 실제 렌더링으로 확인해 전체 글꼴 포함으로 해결했습니다.
- 화면 확대 배율과 독립된 A4 레이아웃입니다. 검색·논문 필터는 내보내기 버튼을 누른 시점의 결과에 적용합니다.
- 기본 저장 폴더는 앱 데이터의 `PaperVocabulary/exports/`입니다. 저장 취소는 오류로 표시하지 않습니다. 실패하면 화면에 오류를 표시하고 다시 내보낼 수 있습니다.
- 생성과 저장은 모두 로컬에서 진행하며 GPT 호출/비용/조회 횟수가 발생하지 않습니다.

PDF 생성 코드와 글꼴은 내보내기를 실행할 때만 불러옵니다. [pdf-lib의 글꼴 측정/임베딩 API](https://pdf-lib.js.org/docs/api/classes/pdffont)를 사용합니다. Nanum Gothic 및 SIL OFL 라이선스는 `src/assets/fonts/`에 포함했습니다.

## 데이터 및 성능

`004_reader_tools.sql`에서 기존 DB를 버전 4로 이관합니다. 기존 Highlight에는 기본 노랑을 설정하며 단어, 문맥, 조회 횟수, 위치, 크레딧과 비용은 유지합니다. 구·문장은 기존 `vocabulary_entries`/`vocabulary_contexts`를 그대로 사용합니다.

기존 페이지 렌더 큐, IntersectionObserver, Canvas/Text Layer 캐시, DPR/픽셀 상한, PDF Zoom 구현과 Linux WebKit 스크롤 설정을 유지합니다. 색상과 취소는 Highlight Layer만 갱신하고 전체 PDF canvas를 재생성하지 않습니다. Vocabulary의 글자 크기를 변경해도 Reader 배율과 페이지 캐시는 유지됩니다.

기존 24페이지·1,152개 Highlight, DPR 2, CPU 4배 제한 시나리오를 3회씩 재측정했습니다. 캐시가 채워진 왕복 스크롤의 App 렌더 2회, Canvas/Text Layer 렌더 각 4회, Highlight 변환 576회, 최대 Canvas 9개/27,264,600픽셀은 Phase 2와 동일했습니다. 프레임 간격 p95 중앙값은 일반 스크롤 27.9ms, 빠른 이동 51.0ms로, 직전 Phase 2 측정의 24.5/46.9ms보다 높았습니다. 프레임 시간에는 환경 편차가 있으므로 속도 개선을 주장하지 않으며, 반복 작업량과 기존 캐시/회귀 시나리오의 보존을 확인했습니다. [일반 스크롤](performance/reader-tools-scroll.json), [빠른 이동](performance/reader-tools-fast-scroll.json), [wheel 입력](performance/reader-tools-wheel.json)에 원본 측정치를 남깁니다.

## 검증

기능 테스트 **87개**: Vitest 19, Rust 27, Playwright 41. 기존 테스트 중 이번 요청으로 명시적으로 바뀐 동작(구·문장 저장, 결과 말풍선 유지, 신규 버튼, DB 버전)만 기대값을 갱신했습니다.

- 기존 파일 열기/드롭, 단어 더블클릭, 하이픈 단어, 여러 줄/여러 페이지 드래그, 번역/설명, 저장과 복원, Zoom/너비 맞춤/Ctrl+휠, Bubble 위치, 캐시/비용 회귀.
- 진행 중/완료 후 스크롤 말풍선 유지와 ESC, 실제 삼중 클릭의 선택 전체 전달/저장.
- 구·문장의 재실행 후 복원, 검색, 캐시 적중, 무과금, 조회 횟수, 저장 실패 롤백.
- 5색 저장/복원, 기존 색상 유지, 선택 위치만 취소, 다른 논문의 Highlight 보호, 취소 후 Vocabulary/Cache 유지, 삭제 실패 처리.
- Vocabulary 확대·축소와 Reader 배율/필터 유지.
- 실제 PDF 생성, A4 크기, 한국어 텍스트 추출, 긴 문장/문맥의 마지막 내용 보존, 페이지 여백, 보기/필터 반영, 취소/실패/무과금.
- Simple/Detailed 각각 3페이지를 Poppler로 렌더링해 모든 페이지의 한글·영문, 2단 정렬, 페이지 경계와 잘림을 확인했습니다. QA PDF와 PNG는 `.tools/export-qa/`에 보관합니다.

```bash
source .tools/env.sh
npm test
OPENAI_API_KEY= npm run test:rust
npm run test:e2e
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PROFILE_LABEL=reader-tools npx playwright test --config tests/performance/playwright.config.ts
npm run tauri build -- --no-bundle
PKG_CONFIG_PATH="$PWD/.tools/bundle-pkgconfig" APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri bundle
```

실제 유료 API 호출은 검증에 사용하지 않습니다. 기존 API 요청/응답 처리는 로컬 HTTP 서버를 사용하는 자동 테스트로 유지합니다.

## 실제 데스크톱 확인

사용자 데이터와 분리한 버전 3 테스트 DB로 네이티브 앱을 실행해 버전 4 이관을 확인했습니다. Linux WebKit에서도 삼중 클릭한 행 전체에 Action Bubble이 표시되고, 캐시 번역 후 해당 문장이 Vocabulary에 저장되며 스크롤해도 결과 말풍선이 유지됐습니다. 조회 횟수는 1→2로 증가하고 API 사용 기록은 0건이었습니다.

최종 AppImage로 다시 실행한 뒤 Vocabulary 기록 복원, 125% 확대, Simple/Detailed의 시스템 저장 대화상자를 통한 실제 파일 저장을 확인했습니다. 기본 exports 폴더에 생성한 PDF를 Poppler로 다시 읽고 렌더링했습니다. 검증 기록과 화면은 `.tools/reader-tools-verification/`에 있습니다.

Clippy, TypeScript/Vite 및 Tauri 릴리스 빌드가 통과했고 DEB/RPM/AppImage를 생성했습니다. Vite는 PDF.js와 내보내기 전용 청크의 크기 경고를 표시하지만 빌드에는 성공했습니다.
