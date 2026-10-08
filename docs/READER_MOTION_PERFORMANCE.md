# Reader 스크롤·줌 추가 최적화

2026-09-24. [이전 줌 검증](ZOOM_PERFORMANCE.md)에 이어 실제 Tauri/WebKitGTK 프로세스에서 남은 지연을 분리했습니다. 기능과 최종 Canvas 해상도는 유지합니다.

## 원인과 변경

- 연속 줌 때 전체 페이지 React 컴포넌트, viewport 계산, 이벤트 effect가 반복 실행됐습니다. 이제 프레임마다 페이지 크기와 완성된 화면의 transform만 갱신하고, 페이지 컴포넌트에는 조작이 끝난 배율을 전달합니다. 배율과 스크롤 기준점 보정은 같은 layout 단계에서 적용합니다. 긴 문서의 기준 페이지 탐색도 순차 검색에서 이진 검색으로 변경했습니다.
- Canvas를 적게 그려도 줌 확정 때 Text Layer를 새로 생성하면서 글자 측정과 DOM 교체 비용이 남았습니다. 이제 기존 글자 노드와 선택 Range를 유지합니다. 별도의 wrapper로 기존 텍스트 좌표를 확대하고, 선택 좌표에 사용하는 viewport는 현재 배율로 갱신합니다. PDF.js의 90/180/270도 회전 transform은 유지합니다.
- 최대/최소 배율에 도달한 뒤에도 이어지는 휠 입력을 조작 중으로 처리합니다. 새 입력이 들어오면 아직 완료되지 않은 이전 배율의 작업을 중단합니다. 최종 배율이 원래 배율로 돌아오는 경우도 다시 시작하거나 완료된 화면을 재사용하며, 기존 Canvas가 있는 동안 빈 화면으로 바꾸지 않습니다.
- 화면 밖에 남겨 둔 Text Layer에 `content-visibility: auto`를 적용했습니다. 화면에 들어온 페이지는 observer와 pointer 입력에서 명시적으로 `visible`로 전환합니다. 자동 전환만 기다리면 캐시된 텍스트의 좌표 측정/클릭이 늦어지는 경우가 있어 별도로 처리했습니다. 선택된 화면 밖 텍스트와 여러 페이지에 걸친 선택도 유지합니다. 관련 동작은 [CSS Containment 명세](https://www.w3.org/TR/css-contain-2/#content-visibility)의 선택 가능성 요구와 함께 실제 브라우저에서 검증했습니다.
- 미리보기 배율을 완성된 렌더로 표시하지 않습니다. 완성된 원래 배율로 되돌아오는 경우에도 준비 상태를 정확히 복원하여 화면 왕복 시 캐시를 유지합니다.

일반 스크롤 handler에는 React state 갱신을 추가하지 않았습니다. 기존 한 개씩 실행하는 PDF 렌더 큐, viewport 우선순위, 900px 선행 렌더 범위, 8페이지/24M pixels 캐시 예산, 선택 보호, DPR 2 및 Canvas 크기 제한은 그대로입니다. 말풍선 스크롤/드래그/닫기와 SQLite/API Cache도 유지합니다.

공통 CSS 배율 변수를 모든 텍스트에 상속하는 방식은 WebKit에서 스타일 재계산 비용이 커져 제외했습니다. 저해상도 Canvas, 강제 합성 레이어, 더 넓은 선행 렌더, 일반 wheel의 passive 변경, Canvas 가속 설정 변경도 비교했지만 일관된 개선을 확인하지 못해 채택하지 않았습니다.

## 실제 Tauri/WebKit 비교

Library에 있던 25페이지·약 4.2MB PDF의 로컬 사본과 테스트용 Highlight 1,152개를 사용했습니다. 별도 SQLite/XDG 폴더에서 실제 릴리스 실행 파일과 실제 X11 휠 입력을 사용했습니다. API/DB mock 없이 실행했으며, 사용자 DB는 읽기 전용으로 파일 위치만 확인했습니다. 원본 논문과 DB 변경, 유료 API 호출은 없습니다.

같은 계측을 넣은 수정 전후 릴리스 바이너리를 각각 3회 실행했습니다. 캐시된 구간 왕복(휠 40회), 처음 보는 구간으로 진행(40회), Ctrl+wheel 확대/축소(20회, 상한 도달 후 방향 전환)를 분리했습니다. 각 실행은 새 프로세스·새 QA DB/캐시를 사용합니다. 아래 값은 3회 중앙값입니다.

| 지표 | 이전 | 이후 |
| --- | ---: | ---: |
| 캐시 구간 rAF 간격 p95 | 16ms | 17ms |
| 첫 방문 구간 rAF 간격 p95 | 69ms | 57ms |
| 첫 방문 구간의 가장 긴 rAF 간격 | 102ms | 72ms |
| 첫 방문 구간 wheel 전달 지연 p95 | 90ms | 48ms |
| 줌 rAF 간격 p95 | 24ms | 18ms |
| 줌의 가장 긴 rAF 간격 | 58ms | 25ms |
| 줌 wheel 전달 지연 p95 | 15ms | 9ms |
| 줌 최종 품질 대기 근사값 | 250ms | 188ms |
| 줌 페이지 컴포넌트 실행 | 394회 | 51회 |
| 줌 Text Layer 생성 | 5회 | 2회 |

이후의 Text Layer 생성 2회는 새로 필요한 페이지에 대한 작업입니다. 기존 텍스트의 줌은 노드를 재사용합니다. 캐시 구간의 차이는 작으며, 새 페이지의 렌더링 대기 자체가 사라진 것은 아닙니다.

측정 환경은 **WebKitGTK, Xvfb 1200×900, DPR 1**입니다. rAF 간격은 JS 프레임 관측치이고 wheel 전달 지연은 이벤트 타임스탬프부터 handler 실행까지의 근사값입니다. Xvfb의 소프트웨어 합성 환경이므로 실제 모니터/GPU의 표시 FPS나 마우스 전체 지연과 동일하지 않습니다. [이전 원시값](performance/motion-native-before.json), [이후 원시값](performance/motion-native-after.json).

## 별도 Chromium 비교

기존 24페이지 생성 PDF, DPR 2, CPU 4배 제한, 선택된 단어/말풍선이 있는 Ctrl+wheel 시나리오도 3회 반복했습니다. 페이지 컴포넌트 호출 중앙값은 1,020→62회, rAF p95는 83.3→50ms, 메인 스레드 작업 시간은 1.257→1.050초였습니다. 최종 배율에서 선택 가능한 시점은 381→416ms로 오히려 조금 늘었습니다. 모든 지표가 개선된 것으로 해석하지 않으며, 네이티브 앱의 수치와 섞지 않습니다. [이전](performance/motion-chromium-before.json), [이후](performance/motion-chromium-after.json).

## 회귀 검증

Vitest 47개, Rust 60개, Playwright 122개로 **229개 통과**. 외부 Codex 인증이 필요한 기존 수동 테스트 1개는 ignored입니다. 기존 Phase 1–3, Library, 캐시, 인쇄, 삭제/Undo 테스트를 모두 실행했습니다. 120페이지 문서의 확대 기준점, 최대 배율 연속 입력, 원래 배율 복귀/캐시 재사용을 추가했습니다. 연속 줌 검증에서는 Text Layer 교체 없이 선택을 유지하고 Canvas만 최종 교체하는 것을 확인합니다.

표시 배율과 완료 배율이 일치한 뒤 실제로 화면에 들어온 텍스트의 좌표를 측정하도록 테스트 대기를 보완했습니다. 기존 회전·DPR·여러 페이지 선택·말풍선·하이라이트·너비 맞춤·화면 왕복·Drop 검증은 유지했습니다. 네이티브 앱에서도 확대 후 실제 마우스 더블클릭과 화면 밖으로 이어지는 3페이지 선택/Action Bubble을 검증했습니다.

계측은 `reader-profile`을 명시한 테스트 빌드에만 포함됩니다. 배포용 빌드는 일반 Vite/Tauri 설정을 사용합니다. 로그와 QA DB는 `.tools/motion-verification/`에 있습니다.

TypeScript/Vite, Rust fmt/clippy, Tauri 릴리스 빌드와 AppImage·DEB·RPM 패키징을 통과했습니다. 설치된 AppImage가 빌드 결과와 같은 해시인지, 계측 코드가 배포물에서 제외됐는지 확인했습니다. 설치본에서도 별도 QA DB로 PDF를 열고 실제 더블클릭 후 Ctrl+wheel 확대 시 선택 영역과 말풍선 정렬을 확인했습니다.

```bash
source .tools/env.sh
# 동일한 계측을 넣은 실제 네이티브 앱. 유료 API 호출 없이 별도 데이터 사용.
npx vite build --config tests/performance/vite.config.ts
cargo build --manifest-path src-tauri/Cargo.toml --release --features reader-profile,tauri/custom-protocol
cp src-tauri/target/release/paper-vocabulary .tools/motion-verification/native-profile
python3 tests/performance/native-motion.py .tools/motion-verification/native-profile /absolute/path/to/fixture.pdf unique-label

PROFILE_LABEL=unique-label npx playwright test --config tests/performance/playwright.config.ts zoom-profile.spec.ts
```

네이티브 시나리오는 24페이지 이상이며 텍스트가 있는 PDF를 사용합니다. 실행 라벨은 기존 QA 데이터를 덮어쓰지 않도록 새 값을 사용합니다.
