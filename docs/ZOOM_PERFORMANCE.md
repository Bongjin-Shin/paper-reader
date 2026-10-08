# 말풍선 스크롤 및 PDF 확대·축소 개선

2026-09-23. 이전 [말풍선 검증 기록](SELECTION_BUBBLE_VERIFICATION.md)의 화면 가장자리 고정 동작은 이번 변경으로 대체합니다.

## 말풍선

스크롤 때마다 화면 경계로 위치를 보정하고 위/아래 배치를 재선택하던 코드 때문에 말풍선이 가장자리에 붙었습니다. 최초 선택 좌표와 말풍선 크기로 배치한 뒤 스크롤 거리만큼 위치에서 빼도록 변경했습니다. 더 큰 결과가 도착하면 최초 선택 좌표 기준으로 배치를 정하며, 스크롤 중의 단어 위치로 배치를 뒤집지 않습니다. 화면 밖으로 나가도 결과 상태는 유지되며, 돌아오면 같은 결과가 보입니다. Reader 밖은 잘라 표시하여 상단 Toolbar나 하단 상태바를 가리지 않습니다.

직접 드래그한 말풍선은 이전 요청대로 화면 위치를 유지합니다. 바깥 클릭 유지, X/Escape/Delete로 말풍선만 닫기, Highlight 선택 후 Delete, 저장 데이터/Cache/Undo 동작은 그대로입니다. 스크롤 중 React state 업데이트나 PDF 레이어 재생성은 하지 않습니다.

## 측정 및 원인

`tests/performance/zoom-profile.spec.ts`에서 실제 PDF.js를 사용했습니다. 24페이지 텍스트·벡터 PDF, 저장 Highlight 1,152개, 1200×900, DPR 2, Chromium CPU 4배 제한에서 같은 Ctrl+wheel 입력 40회를 재생하고 125% → 약 167%의 최종 렌더 완료까지 측정했습니다. 실행마다 PDF를 새로 열고 단어를 선택했습니다. API/SQLite IPC는 테스트 대역이며 유료 호출은 없습니다.

기존 코드는 입력 배율마다 모든 페이지 component를 갱신하고, 유지 중인 Canvas/Text Layer를 제거한 뒤 새로 만들었습니다. 연속 입력 중 취소되는 중간 배율에도 PDF.js 작업과 Highlight 좌표 변환이 반복됐습니다.

3회 측정 중앙값:

| 지표 | 이전 | 이후 |
| --- | ---: | ---: |
| Canvas / Text Layer 생성 | 20 / 20 | 2 / 2 |
| Highlight 좌표 변환 | 3,094 | 405 |
| 메인 스레드 작업 시간 | 3.389초 | 1.410초 |
| 프레임 간격 p95 | 200ms | 100ms |
| 50ms 이상 Long Task | 30 | 3 |
| Layout 시간 | 134ms | 42ms |
| 마지막 입력 후 최종 배율 선택 가능 | 340ms | 395ms |

[이전 측정값](performance/zoom-before.json), [이후 측정값](performance/zoom-after.json). CPU 제한과 개발 모드에서 측정한 비교 수치로, 실제 Tauri WebKit의 FPS를 뜻하지 않습니다. 모든 지표가 줄어든 것은 아닙니다. 최종 선명도 갱신까지는 조작 후 대기 시간이 추가되며, 페이지 component 호출도 974 → 1,020회입니다. 개선의 주된 이유는 중간 배율의 PDF.js 작업과 좌표 재계산 감소입니다.

## 변경

- 표시 배율과 Canvas/Text 렌더 배율 분리. 조작 중 완성된 Canvas/Text/Highlight를 같은 비율로 조절합니다.
- 마지막 입력 후 140ms에 최종 배율 렌더 시작. 새 Canvas/Text가 모두 완성될 때까지 이전 화면을 유지하고 교체 후 이전 Canvas 버퍼 해제.
- Ctrl+wheel 이벤트는 RAF로 프레임당 한 번 합치되 입력량과 마우스 기준 확대 위치 유지.
- 확대 중 기존 캐시를 유지하고 최종 렌더 때만 교체. 기존 viewport 큐, 페이지 선행 렌더, 선택 보호, DPR/Canvas 상한 유지.
- 미리보기는 최종 렌더 완료로 표시하지 않습니다. 새 배율의 Canvas/Text가 완성된 뒤 선택 가능 상태를 표시하여 너비 맞춤 후 화면 왕복도 기존 노드를 재사용합니다.
- PDF 교체/종료 시 이전 확대 타이머와 휠 요청 정리. 최종 렌더 뒤 선택/말풍선 좌표 복원.

## 검증

자동 검증은 양방향·가로 스크롤의 정확한 말풍선 이동/화면 밖 왕복, 화면 위쪽 단어의 초기 결과 가독성, 연속 확대 중 기존 노드 재사용, 최종 Canvas/Text 한 번 교체 및 빈 프레임 없음, 이전 버퍼 해제, 확대 반전/Drop, 선택/Highlight 정렬, fit, 화면 왕복을 포함합니다. 기존 Reader·Vocabulary·Library·인쇄·Cache·삭제/Undo·ChatGPT 연결 회귀 테스트도 다시 실행했습니다. Vitest 47개, Rust 60개, Playwright 119개로 총 226개 통과. 외부 인증이 필요한 Codex 런타임 수동 테스트 1개는 기존대로 ignored입니다. TypeScript/Vite 및 Tauri release 빌드와 Rust fmt/clippy를 통과했습니다.

Linux WebKitGTK 릴리스 앱에서는 별도 QA 데이터와 24페이지 PDF로 실제 마우스 휠 왕복, 화면 밖 말풍선 복귀, 빠른 Ctrl+wheel 확대/축소, 너비 맞춤 후 단어 선택과 말풍선 정렬을 확인했습니다. 유료 호출과 사용자 실제 DB 변경 없이 검증했습니다.

원본 로그/스크린샷: `.tools/zoom-verification/`.

```bash
source .tools/env.sh
PROFILE_LABEL=current OPENAI_API_KEY= npx playwright test --config tests/performance/playwright.config.ts zoom-profile.spec.ts
```
