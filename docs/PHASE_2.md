# Phase 2 구현 및 검증

2026-09-22. 기존 명세서와 Phase 2 요청을 기준으로 구현했습니다. Phase 3의 Print/PDF Export는 포함하지 않습니다.

## 구현 동작

| 항목 | 동작 |
| --- | --- |
| Vocabulary | 상단에서 PDF Reader와 전환하며 기존 로컬 SQLite를 사용 |
| Simple View | 영어 단어와 한국어 뜻만 표시 |
| Detailed View | 단어, 뜻, 설명, 원문 문장, 논문명, 페이지, 전체 조회 횟수 표시 |
| 검색 | 영어 단어 부분 일치(대소문자 무시), 저장된 한국어 뜻 부분 일치 |
| 논문 필터 | SQLite Paper 목록 사용, 해당 논문의 문맥과 뜻 표시 |
| 여러 문맥 | 같은 단어의 모든 논문·페이지·문장을 표시하고 동일 문맥의 번역/설명은 묶어서 표시 |
| Lookup Count | 성공한 명시적 번역/설명 요청마다 증가. 캐시 재사용도 포함 |
| Highlight 클릭 | 해당 위치의 저장 결과를 DB에서 즉시 읽고, 저장된 다른 action도 있으면 전환 가능 |
| API Cache | 동일 단어 + 정확히 같은 문맥 + 동일 action이면 저장 결과 재사용 |

Simple View는 필터 범위 내 최근 저장 번역을 사용합니다. 설명만 저장된 단어는 뜻을 `—`로 표시하며, 화면 표시를 위해 새 API 요청을 만들지 않습니다. Detailed View에서는 각 문맥에 실제 저장된 번역/설명을 보여줍니다.

Lookup Count는 단어 전체의 값입니다. 논문 필터를 적용해도 변하지 않습니다. 단순 선택, 실패한 요청, Highlight 재열람, Vocabulary 열람은 횟수를 증가시키지 않습니다.

## 기존 데이터와 캐시

`003_vocabulary.sql`은 버전 1/2 DB를 버전 3으로 자동 이관합니다. 기존 성공 조회마다 남아 있는 Context 수로 조회 횟수를 복원합니다. 기존 Paper, 단어, Context, Highlight 좌표, API 크레딧과 사용 비용은 유지됩니다. 다시 실행해도 횟수를 중복 복원하지 않습니다.

별도 외부 저장소 없이 기존 `vocabulary_contexts` 결과를 영속 캐시로 사용합니다. 기존 단어 정규화 규칙(대소문자, 아포스트로피)은 유지하고, 문맥 문자열과 action은 정확히 비교합니다. 논문이나 페이지가 달라도 세 값이 같으면 재사용합니다. 캐시 조회를 API 키 검증보다 먼저 수행하므로 키가 없어도 저장된 결과를 사용할 수 있습니다.

캐시 재사용 시에도 이번 조회 위치의 Context, Highlight와 Lookup Count를 하나의 트랜잭션으로 저장합니다. 기존 위치에는 Highlight가 중복되지 않습니다. API 호출과 사용 비용 기록은 생략합니다. 문맥이나 action이 달라 캐시가 없으면 기존 API 호출 경로를 사용합니다. 구·문장 선택은 Phase 1의 결과 표시/비용 기록 동작을 유지하며 Vocabulary에는 저장하지 않습니다.

Highlight는 자신이 참조하는 Context의 결과를 읽습니다. 다른 문맥에서 나중에 저장된 뜻으로 바꾸지 않습니다. 저장 결과를 읽다가 실패해도 재시도는 DB만 읽으며 API를 호출하지 않습니다.

## Reader 성능 보존

- 기존 렌더 큐, viewport 우선 렌더링, Canvas/Text Layer 캐시, 픽셀 상한 및 Zoom 구현은 변경하지 않았습니다.
- Linux WebKit의 smooth scrolling 비활성화를 유지했습니다.
- Vocabulary로 이동해도 Reader의 크기와 PDF 컴포넌트를 유지하므로 배율, 스크롤, Canvas/Text Layer를 재사용합니다. 숨겨진 Reader에는 `inert`를 적용합니다.
- Vocabulary의 DB 조회는 해당 화면이 활성화됐을 때만 실행합니다. Reader로 돌아가면 단어 목록 DOM은 제거하고 필터/보기 상태만 유지합니다.
- Highlight 클릭은 기존 Text Layer에서 클릭을 판별합니다. Overlay가 선택 이벤트를 가로채지 않으며, 좌표 판별은 클릭 때만 수행합니다. 스크롤마다 Highlight를 조회하거나 계산하지 않습니다.

기존 성능 시나리오를 같은 조건(24페이지 PDF, 1,152개 Highlight, Chromium, 1200×900, DPR 2, CPU 4배 제한)에서 3회씩 측정했습니다. 일반 왕복 스크롤과 빠른 이동의 원시 결과는 각각 [일반 스크롤](performance/phase2-scroll.json), [빠른 이동](performance/phase2-fast-scroll.json)에 보관합니다. 이전 기준은 [Phase 1 일반 스크롤](performance/scroll-followup.json), [Phase 1 빠른 이동](performance/fast-after.json)입니다.

| 지표 | Phase 1 기준 | Phase 2 최초 측정 | Phase 2 최종 확인 |
| --- | ---: | ---: | ---: |
| 일반 스크롤 프레임 간격 p95, 3회 중앙값 | 23.0ms | 23.7ms | 24.5ms |
| 빠른 이동 프레임 간격 p95, 3회 중앙값 | 43.4ms | 39.7ms | 46.9ms |
| 일반 스크롤 전체 작업 시간 중앙값 | 2.659s | 2.496s | 2.570s |
| 일반 스크롤 App 렌더 횟수 | 2 | 2 | 2 |
| 캐시가 채워진 일반 스크롤 Canvas/Text 렌더 횟수 | 4 / 4 | 4 / 4 | 4 / 4 |
| 캐시가 채워진 일반 스크롤 Highlight 좌표 변환 | 576 | 576 | 576 |
| 관측 최대 Canvas / 전체 픽셀 | 9 / 27,264,600 | 9 / 27,264,600 | 9 / 27,264,600 |

최종 확인은 비활성 Vocabulary 목록의 DOM 제거를 적용한 뒤 수행했습니다. [최종 일반 스크롤](performance/phase2-final-scroll.json), [최종 빠른 이동](performance/phase2-final-fast-scroll.json)을 함께 남깁니다. 일반 스크롤의 반복 작업량과 캐시 규모는 동일했습니다. 빠른 이동은 최종 3회에서 p95 50.0/46.9/41.5ms, 50ms 이상 작업 2/2/0개로 변동했으므로 지속적인 속도 향상을 주장하지 않습니다. 스크롤마다 새로운 Vocabulary 조회나 전체 목록 렌더링이 추가되지는 않았습니다.

측정치는 합성 PDF와 해당 테스트 환경의 값입니다. 실제 PDF 복잡도와 운영체제별 체감 성능을 보장하는 수치는 아닙니다. 추가 기능으로 인한 반복 렌더링·메모리 증가 여부와 기존 스크롤 최적화 보존을 확인하는 데 사용했습니다.

## 자동 검증

**74개 기능 테스트 통과**: Vitest 16개, Rust 23개, Playwright 35개. 기존 Phase 1 테스트를 유지하며 Phase 2의 Rust 6개와 화면 11개를 추가했습니다.

별도로 일반 스크롤, 빠른 이동, 실제 wheel 입력을 측정하는 성능 시나리오 3개도 완료했습니다. [wheel 입력 측정 원본](performance/phase2-final-wheel.json)도 보관합니다.

- 기존 PDF 열기/드롭, 더블클릭, 드래그 및 여러 페이지 선택, 하이픈 단어, 번역/설명, SQLite 저장, Highlight 생성/복원, Bubble 수명, Zoom/너비 맞춤/Ctrl+휠, API 비용과 실패 처리.
- Simple/Detailed, 영어/한국어 검색, 전체 Paper 필터, 여러 논문 문맥, 설명만 있는 항목, 빈 화면/오류/재시도.
- 캐시의 단어/문맥/action 구분, 다른 논문에서 재사용, 재시작 후 재사용, 무과금, 횟수 증가, 실패 시 트랜잭션 롤백.
- Highlight 결과의 문맥 일치, 저장된 번역/설명 전환, 재열람 시 횟수/비용 불변, 늦은 응답 무시, 회전/Zoom 후 클릭 좌표.
- Vocabulary 왕복 후 동일 Canvas/Text Layer 객체와 스크롤·너비 맞춤 배율 유지, 조회 진행 중 페이지 전환.
- DB 버전 1/2 이관과 데이터 보존, 재실행 시 중복 집계 방지.

실행 명령:

```bash
source .tools/env.sh
npm test
npm run test:e2e
OPENAI_API_KEY= npm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PROFILE_LABEL=phase2-final npx playwright test --config tests/performance/playwright.config.ts
npm run tauri build -- --no-bundle
PKG_CONFIG_PATH="$PWD/.tools/bundle-pkgconfig" APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri bundle
```

TypeScript 검사, Vite 빌드, Clippy, Tauri 릴리스 빌드 및 DEB/RPM/AppImage 생성에 성공했습니다. Vite의 기존 PDF.js 번들 크기 경고는 남아 있으며 빌드를 막지 않습니다.

## 실제 Tauri / SQLite 확인

사용자 DB와 분리한 테스트 데이터 폴더와 빈 API 키로 Linux Tauri 실행 파일 및 최종 AppImage를 실행했습니다. UI와 SQLite를 함께 확인했습니다.

1. Paper 2개, 단어 1개, Context 3개, 초기 크레딧 $5인 버전 2 DB가 버전 3으로 이관되고 조회 횟수 3으로 복원됨.
2. OS 파일 드롭으로 PDF 열기 → 단어 더블클릭 → 번역 실행. 키 없이 캐시 결과 표시, 조회 횟수 4, Context 4개, Highlight 1개, API 사용 기록 0개.
3. Highlight 클릭 → 저장된 번역과 설명 전환. 조회 횟수와 비용 변화 없음.
4. Simple/Detailed, 두 논문의 문맥과 논문 필터 확인.
5. 앱 종료 후 최종 AppImage로 다시 실행 → PDF 드롭 → Highlight와 저장 결과 복원. Vocabulary에서 대문자 부분 검색, 두 논문 문맥, 조회 4회, 잔액 $5 유지 확인.

검증 화면과 재시작 전후 DB 상태는 `.tools/phase2-verification/`에 보관했습니다. Xvfb의 소프트웨어 렌더링 환경에서는 첫 화면 갱신을 위해 창 크기를 변경했습니다. 실제 유료 OpenAI 호출은 실행하지 않았으며, 네트워크 요청 형식과 응답/비용 처리는 로컬 HTTP 서버를 사용하는 기존 자동 테스트로 검증했습니다.

AppImage 테스트 프로세스의 stderr에는 `GStreamer element appsink not found` 메시지가 있었습니다. 위 PDF/단어장 검증 흐름은 실행됐으며, 미디어 재생은 이번 구현 및 검증 범위에 없습니다.

생성한 Linux 패키지는 `src-tauri/target/release/bundle/`에 있습니다.
