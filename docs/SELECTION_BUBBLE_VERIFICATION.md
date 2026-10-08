# 선택 해제와 말풍선 조작 검증

검증일: 2026-09-23

- Library / Vocabulary: 선택한 행을 일반 클릭하면 해당 항목만 해제. 새 항목 클릭은 단일 선택. Ctrl/Command, Shift, 사각형 선택, 일괄 폴더 이동 유지.
- Library는 pointerdown의 선행 선택을 실제 드래그 시작 시점으로 이동해 한 번 클릭에 두 번 토글되는 문제 방지.
- 번역 진행 중·결과·오류는 바깥 클릭으로 닫히지 않음. X 및 말풍선 클릭 후 Escape/Delete는 UI만 닫으며 늦은 응답이 다시 열지 않음.
- 기본 말풍선은 단어를 따라가고 화면 밖에서는 가장자리에 유지. 실제 드래그 후에는 화면 위치 고정. 새로운 선택은 기본 추적으로 시작.
- 스크롤은 passive listener / requestAnimationFrame으로 말풍선의 위치만 변경. 스크롤 중 React state 업데이트나 레이어 측정 없음. 줌·창 크기·결과 크기 변경 시 좌표 갱신.
- Highlight 선택 후 Delete는 해당 표시만 제거. 말풍선을 클릭하면 Delete 대상이 말풍선으로 바뀜. 입력창·IME·조합키·반복 키는 삭제 단축키에서 제외.

자동 검증: Vitest 47개, Rust 60개, Playwright 114개 통과. 외부 Codex 런타임 수동 테스트 1개는 기존대로 ignored. 실제 유료 번역 호출 없이 테스트 더블로 요청·Cache·저장 경로 검증.

추가 회귀 검증에는 두 목록의 재클릭/기존 다중 선택, PDF 열기/드롭/선택/줌/색상, 저장·Cache, Highlight 삭제/실패/Undo/Redo, 인쇄·PDF 출력, Library·메모·탐색, ChatGPT 연결 UI가 포함됨. 스크롤 중 선택 페이지 DOM 변경 0건 및 Canvas/Text/Highlight 노드 동일성 확인.

TypeScript/Vite, Tauri release 빌드 및 AppImage/deb/rpm 패키징 완료. Rust fmt/clippy 통과. Vite의 기존 큰 청크 안내만 발생.

Linux WebKitGTK 실제 앱에서는 별도 QA 데이터로 확인:

- Library / Vocabulary 재클릭 선택 해제.
- 저장 결과의 바깥 클릭 유지, 기본 스크롤 추적, 드래그 후 고정.
- 클릭을 놓은 뒤 Delete로 말풍선만 닫기: 단어 4 / 문맥 4 / Highlight 4 유지.
- Highlight 클릭 후 Delete: Highlight만 4 → 3. Ctrl+Z 후 다시 4.
- API 사용 기록 0 유지. 사용자 실제 DB는 QA에서 사용하지 않음.
- 설치 AppImage와 빌드 산출물 SHA-256 일치 및 설치본 시작/선택 해제 확인.

로그와 스크린샷: `.tools/selection-bubble-verification/`.
