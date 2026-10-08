# Phase 1 스크롤 성능 검증

2026-09-22. 기능 추가 없이 PDF Reader의 렌더링 경로와 Linux WebKit 스크롤 설정을 수정했습니다.

## 후속 수정: 빠른 휠 입력 뒤 화면이 가속하며 따라오는 현상

사용자가 후속으로 설명한 증상은 단순한 페이지 로딩 대기와 달랐습니다. Linux Tauri가 사용하는 WebKitGTK의 `enable-smooth-scrolling` 기본값이 `TRUE`여서, 짧은 휠 입력을 받은 뒤에도 화면 위치를 보간하면서 계속 이동했습니다. PDF와 React를 제외한 최소 WebKitGTK 스크롤 화면에서도 동일한 현상을 재현했습니다.

`tests/performance/webkit-wheel-profile.py`에서 실제 X11 마우스 휠 입력을 10ms 간격으로 20회 전달했습니다. WebKitGTK 2.52, Xvfb에서 설정별로 3회 측정했습니다. 두 설정 모두 최종 이동 거리는 1,780px로 같았습니다.

| native 휠 입력 지표 | 기본 smooth scrolling | 비활성화 후 |
| --- | ---: | ---: |
| 마지막 휠 이벤트 → 마지막 scroll 이벤트, 중앙값 | 213ms | 0ms |
| 위 시간의 3회 범위 | 206–213ms | 0–1ms |
| 마지막 휠 이벤트 시점 이후 남은 이동 거리, 중앙값 | 1,389px | 89px |

89px는 마지막 휠 한 번의 정상 이동량입니다. 마지막 wheel listener는 그 이벤트의 기본 스크롤 동작보다 먼저 실행되므로 이 값에도 포함됩니다. 이것은 PDF의 FPS 측정이 아니라 WebKit 스크롤 보간의 후행 이동을 분리한 실험입니다. [native 원시 측정값](performance/webkit-wheel.json)을 보관했습니다.

Linux 앱 초기화에서 실제 WebView의 `settings.set_enable_smooth_scrolling(false)`를 적용했습니다. 휠 이동량을 JavaScript로 덮어쓰지 않으며, Ctrl+wheel의 기존 `preventDefault`와 PDF 확대 계산은 유지합니다. 터치패드·운영체제가 직접 생성하는 관성 입력 자체를 제거하는 설정은 아닙니다. Rust 초기화 코드이므로 기존 실행 중인 앱을 종료하고 새 빌드로 재실행해야 적용됩니다.

일반 휠을 막는 listener도 분리 실험했습니다. Chromium CDP의 실제 휠 입력 trace에서는 휠 시작 이벤트만 메인 스레드 응답을 기다렸고, 이후 compositor 입력→프레임 p95는 약 21ms였습니다. 강제로 passive로 바꿔도 일관된 개선이 없었습니다. 따라서 Ctrl+wheel 동작을 바꾸는 우회 처리는 채택하지 않았습니다. 이 Chromium 결과를 WebKit 설정 검증으로 대신하지 않았습니다.

### 급격한 페이지 이동 렌더링도 개선

기존 120px/frame 왕복 측정만으로는 빠른 이동을 충분히 검증하지 못했습니다. 같은 24페이지 PDF, DPR 2, CPU 4배 제한에서 매 프레임 한 페이지씩 이동한 후 24→4→20→8→16페이지로 급격히 이동하는 시나리오를 추가했습니다. 각 회차는 문서를 새로 열며, Canvas와 Text Layer가 완료되어 선택 가능한 시점까지 대기를 측정합니다. 아래는 3회 중앙값이며, 도착 대기는 15회 이동 전체의 중앙값입니다.

| 빠른 이동 지표 | 이번 수정 전 | 이번 수정 후 |
| --- | ---: | ---: |
| 프레임 간격 p95 | 86.4ms | 43.4ms |
| 메인 스레드 TaskDuration | 1.861초 | 1.180초 |
| 도착 페이지가 선택 가능해질 때까지 | 165.1ms | 98.7ms |
| Canvas / Text Layer 생성 | 32 / 32 | 13 / 13 |
| 50ms 이상 Long Task | 8 | 2 |
| LayoutDuration | 85ms | 51ms |

기존 FIFO 큐는 16페이지로 이동해도 앞의 15페이지부터 처리했습니다. 현재는 viewport에 실제로 보이는 면적을 기준으로 우선순위를 정합니다. 큐 시작을 requestAnimationFrame으로 합치고, Canvas 할당 직전에 최신 스크롤 위치로 다시 확인합니다. PDF.js의 메인 스레드 Canvas 작업은 한 번에 하나만 진행합니다. 주변 900px 선행 렌더만 마지막 scroll 후 100ms까지 기다리며, 보이는 페이지에는 이 대기 시간을 적용하지 않습니다.

이미 지나친 미완료 페이지는 PDF.js `onContinue` 및 Text Layer 생성 전에 취소합니다. 취소된 Canvas가 아직 끝나지 않은 텍스트 추출을 기다리며 큐를 점유하지 않도록 두 작업의 종료를 함께 처리합니다. 선택 중인 페이지는 보존하며, 기존 Canvas 해상도·선택/Highlight 좌표 변환은 유지했습니다. 위치 캐시는 observer 알림 때 갱신하고 zoom 때 무효화합니다. scroll handler 자체에는 React state 변경이나 전체 페이지 위치 측정이 없습니다.

지연이 항상 0이 되는 것은 아닙니다. 첫 급격한 이동인 24페이지는 수정 후에도 150–207ms가 걸렸습니다. 보통 속도의 기존 왕복 측정 p95는 이전 32ms에서 이번 23ms로 줄었습니다. 같은 시나리오에서 peak Canvas는 선택된 페이지 보호 및 퇴출 전환 때문에 9개(픽셀 버퍼 약 104MiB)까지 일시적으로 관찰됐습니다. 캐시 예산은 기존과 같고, 화면 주변/선택 페이지를 보호하는 예외도 유지합니다.

[빠른 이동 수정 전](performance/fast-before.json), [수정 후](performance/fast-after.json), [기존 왕복 시나리오 재측정](performance/scroll-followup.json)에 원시 집계값을 보관했습니다. 이 값은 Chromium 개발 모드 측정이며 Tauri WebKit의 FPS를 뜻하지 않습니다.

### 후속 검증

Vitest 16개, Rust 17개, Playwright 24개로 총 57개를 통과했습니다. 기존 테스트를 유지하고 큐의 동적 우선순위·RAF 합치기·지나친 작업 취소·드래그 anchor 보호·Drop 시 타이머 정리, 빠른 방향 전환 뒤 선택/Highlight/확대, 렌더 중 fit/Drop을 추가했습니다. 기존 double-click, drag selection, hyphenated word, SQLite 저장/복원, 사용량, Ctrl+wheel, Bubble, PDF Drop 테스트도 통과했습니다.

Clippy 경고 검사와 Tauri release 빌드를 통과했으며 DEB/RPM/AppImage를 다시 생성했습니다. 최종 Linux Tauri 실행 파일에서 24페이지 PDF OS Drop, 빠른 휠 70회 왕복, 복귀 후 더블클릭, Ctrl+wheel 125%→150% 확대와 선택/Bubble 정렬을 확인했습니다. 실제 OpenAI 호출은 하지 않았습니다. Phase 2 기능은 추가하지 않았습니다.

```bash
source .tools/env.sh
PROFILE_LABEL=current npx playwright test --config tests/performance/playwright.config.ts
# 별도로 실행한 Xvfb 또는 테스트용 X11 display가 필요합니다.
DISPLAY=:99 /usr/bin/python3 tests/performance/webkit-wheel-profile.py
```

아래는 앞선 1차 최적화의 측정 기록입니다. 현재 큐 동시성과 observer/scroll 설정은 위 후속 수정 설명이 최신입니다.

## 측정 방법과 결과

수정 전에 계측용 Vite 서버와 Chromium DevTools Protocol trace로 측정했습니다. 실제 PDF.js가 24페이지의 텍스트·벡터 PDF를 읽고, 페이지마다 저장된 Highlight 48개를 표시합니다. 1200×900, DPR 2, CPU 4배 제한에서 약 8페이지를 내려갔다 올라오는 동작을 두 번 수행했습니다. 총 280개 animation frame에 같은 스크롤 거리를 입력하고 3회 측정했습니다. 최초 화면 로딩은 측정 구간에서 제외했습니다.

Tauri IPC는 테스트 대역이며 API 호출은 없습니다. React 개발 모드와 StrictMode가 동일하게 적용되므로 아래 component 호출 횟수에는 개발 모드의 중복 호출이 포함됩니다. 수치는 세 번의 중앙값입니다. 이 수치를 실제 데스크톱 WebKit의 절대 FPS로 해석하면 안 됩니다.

| 지표 | 최적화 전 | 최적화 후 |
| --- | ---: | ---: |
| 프레임 간격 p95 | 45.6ms | 32.0ms |
| 25ms를 초과한 프레임 / 280 | 80 | 38 |
| 메인 스레드 TaskDuration | 5.387초 | 3.398초 |
| JavaScript 실행 시간 | 1.044초 | 0.392초 |
| 50ms 이상 Long Task | 7 | 0 |
| App 함수 호출 | 4 | 2 |
| 페이지 component 함수 호출 | 254 | 100 |
| Canvas 렌더 시작 | 34 | 10 |
| Text Layer 생성 | 34 | 10 |
| Highlight 좌표 변환 | 12,192 | 960 |
| 최대 유지 Canvas 수 | 2 | 8 |
| Canvas backing store 추정치 (RGBA) | 23.1MiB | 92.5MiB |

프레임 p95는 약 30%, 메인 스레드 작업 시간은 약 37% 줄었습니다. 첫 측정에서는 아직 캐시에 없는 페이지 때문에 Canvas/Text Layer를 각각 15회 생성했고, 이후 두 측정에서는 각각 10회였습니다. 캐시만 추가한 중간 실험에서는 p95가 약 44ms로 충분히 개선되지 않았습니다. 화면 밖 Canvas·Highlight의 페인트 작업을 생략한 뒤 프레임 시간이 개선됐습니다.

모든 세부 지표가 감소한 것은 아닙니다. `content-visibility` 전환으로 LayoutCount는 73→109로 증가했으며, LayoutDuration은 약 67→71ms였습니다. 반면 스타일 재계산 시간은 약 71→51ms로 줄었고 전체 메인 스레드 작업 시간과 긴 프레임은 감소했습니다. 초기 비용을 숨기는 무제한 캐시는 사용하지 않았습니다.

[최적화 전 측정값](performance/before.json), [최적화 후 측정값](performance/after.json)에 3회 원시 집계값을 보관했습니다. 개발용 계측 코드는 일반 앱 빌드에 포함되지 않습니다.

## 항목별 원인과 변경

| 확인 항목 | 확인 결과와 변경 |
| --- | --- |
| 스크롤과 React state | 모든 scroll 이벤트가 전체 앱을 다시 렌더링하지는 않았습니다. 다만 Bubble이 없어도 `setBubble(null)`을 반복 호출했습니다. 현재는 passive listener에서 Bubble 존재 여부를 먼저 확인하고 40px 기준을 넘었을 때 한 번만 닫습니다. |
| Highlight Layer | 페이지 component가 실행될 때마다 모든 rect를 변환했고 App에서도 매번 페이지별 배열을 새로 만들었습니다. `PdfPages`, `PdfPage`, Highlight Layer를 memo 처리하고 페이지별 배열·viewport를 안정화했습니다. |
| Text Layer | 관찰 범위를 나간 페이지에서 DOM을 제거해 재방문 때 전체를 새로 생성했습니다. 최근 페이지의 Canvas와 Text Layer를 함께 재사용하고, 유지 중인 페이지의 텍스트 추출 결과도 확대 때 재사용합니다. |
| Canvas 동시 렌더 | 기존에도 전체 Canvas를 동시에 그리지는 않았습니다. 확대·빠른 이동 때의 요청에는 동시 작업 상한이 없었습니다. 현재 문서당 최대 2개의 렌더 작업만 실행하며 오래된 대기 작업을 취소합니다. |
| 화면 밖 페이지 비용 | 최근 페이지 캐시는 최대 8페이지·96MiB의 backing-store 예산을 기준으로 퇴출합니다. 퇴출 시 Canvas 크기를 0으로 만들어 픽셀 버퍼를 해제하고 Text Layer·추출 데이터·PDF.js 페이지 리소스를 정리합니다. |
| IntersectionObserver | 페이지마다 viewport 기준 observer가 있었으며 중첩된 `.reader` 스크롤 영역의 clipping으로 rootMargin의 선행 렌더 효과가 제한됐습니다. 실제 `.reader`를 root로 하는 observer 하나가 900px 앞뒤의 페이지를 준비합니다. |
| scroll / wheel handler | 일반 scroll은 상수 시간의 위치 비교뿐이므로 RAF나 throttle 대기 없이 처리합니다. Ctrl + wheel은 브라우저 확대를 막아야 하므로 기존 non-passive listener를 유지합니다. 일반 wheel은 가로채지 않습니다. |
| layout / reflow / Bubble | 페이지 내부에 layout·paint containment를 적용했습니다. Canvas·Highlight에는 `content-visibility: auto`를 적용했으며 Text Layer에는 적용하지 않았습니다. 관련 없는 페이지가 렌더됐을 때 Bubble의 위치를 다시 읽지 않고, 좌표가 같으면 Bubble state를 교체하지 않습니다. |
| DPR / Canvas 크기 | 기존 DPR 상한 2는 유지합니다. 큰 PDF·높은 배율에서는 추가로 16,777,216 pixels 및 한 변 8,192px 상한을 적용합니다. CSS 크기와 PDF 좌표는 그대로이므로 Text Layer·선택·Bubble·Highlight 위치에 영향을 주지 않습니다. |

페이지 크기 placeholder와 페이지 메타데이터는 유지합니다. 전체 React 페이지 목록을 제거하는 방식의 virtualization은 페이지 간 드래그 선택과 혼합 크기 문서의 스크롤 위치를 불안정하게 만들 수 있어 적용하지 않았습니다. 비용이 큰 Canvas/Text Layer에만 캐시와 지연 렌더링을 적용했습니다.

캐시는 재방문 비용을 줄이는 대신 메모리를 더 사용합니다. 화면 주변에 필요한 페이지 및 현재 브라우저 선택 범위가 포함된 페이지는 퇴출하지 않아 예산을 일시적으로 초과할 수 있습니다. 확대할 때 화면 밖의 캐시를 비워 불필요한 고해상도 렌더를 막습니다. 일반 배율의 DPR 1·2 해상도는 그대로이며, 매우 큰 페이지/높은 배율에서만 backing-store 해상도를 제한합니다.

## 회귀 검증과 재실행

기존 테스트를 유지했고 아래를 추가했습니다.

- 최근 페이지 재방문 시 같은 Canvas/Text Layer 재사용, 선택 및 Highlight 위치 유지.
- 24페이지 순회 후 오래된 버퍼 해제, 재방문 시 Text Layer/Highlight 복원.
- 페이지를 가로지르는 드래그 선택 → 확대 → 선택한 전체 텍스트 번역.
- 멀리 스크롤한 상태에서 PDF Drop으로 교체, 이전 렌더 취소와 새 캐시 구성.
- DPR 3 및 큰 UserUnit에서 backing-store 상한과 단어 Highlight 정렬.
- 렌더 큐 동시성·오류 후 진행·취소된 대기 작업 무실행, 픽셀/치수 상한.

일반 자동 테스트는 Vitest 12개, Rust 17개, Playwright 22개로 총 51개입니다. 성능 시나리오는 별도로 3회 측정합니다.

같은 파일 ID를 연속으로 여는 경우도 PDF.js `loadingTask.docId`별로 페이지 목록을 다시 만들어 이미 폐기된 페이지 proxy가 새 캐시에 들어가지 않도록 했습니다. 연속 Drop 관련 테스트 2개를 각각 5회 반복해 임시 페이지 오류가 발생하지 않는지 추가 확인했습니다.

Linux Tauri 릴리스 실행 파일에서도 별도 Xvfb·테스트 데이터 폴더를 사용해 24페이지 PDF의 OS Drop, 마우스 휠 스크롤 왕복, 복귀 후 단어 더블클릭, 125%→150% 확대 시 선택과 Bubble 정렬을 확인했습니다. 이 확인은 WebKit 호환성 검증이며 위 Chromium 수치를 WebKit 성능 수치로 대체하지 않습니다.

```bash
source .tools/env.sh  # 이 작업 환경의 로컬 도구 사용 시
npm test
npm run test:e2e
npm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PROFILE_LABEL=current npx playwright test --config tests/performance/playwright.config.ts
```

성능 결과와 Chrome trace는 `.tools/scroll-profile/current*.json`에 저장됩니다. 계측 서버는 1421 포트를 사용하므로 기존 개발 서버와 분리됩니다. 이 명령은 현재 코드의 성능을 측정하며 `before.json`은 최초 수정 전 기록입니다. 성능 수치는 시스템 부하에 영향을 받으므로 일반 테스트에서 밀리초 기준으로 성공/실패를 판정하지 않습니다.

Tauri 빌드는 [README의 환경별 빌드 명령](../README.md#검증과-빌드)을 사용합니다. Phase 2는 구현하지 않았습니다.
