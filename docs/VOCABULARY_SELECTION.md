# Vocabulary 다중 선택과 Linux 앱 실행

2026-09-23.

## Vocabulary

Library의 선택 로직을 공통 훅으로 분리해 Simple/Detailed View에 적용했습니다. Ctrl/Command 클릭은 개별 선택·해제, Shift 클릭은 현재 보이는 순서의 구간 선택, Ctrl+Shift 클릭은 구간 추가입니다. 체크박스와 전체 선택 및 선택 삭제도 유지합니다. 빈 공간에서 사각형 드래그를 시작하고 위·아래 가장자리에서 자동 스크롤합니다. Escape로 드래그를 취소하면 이전 선택으로 돌아갑니다.

순서 섞기는 선택한 ID를 유지하며 이후 Shift 선택에는 섞인 순서를 사용합니다. 검색·논문 필터·화면 이동 시 선택을 해제합니다. 보기·배율 변경 시 완료된 선택은 유지하고 진행 중인 드래그는 취소해 오래된 좌표를 사용하지 않습니다. 단어와 원문 문장의 텍스트 복사, 검색 입력과 기존 인쇄·내보내기 동작은 유지합니다.

선택 안내가 나타나도 행 위치가 이동하지 않도록 공간을 유지합니다. 행 좌표는 드래그 시작 시 한 번 읽고 움직임과 자동 스크롤은 requestAnimationFrame으로 처리합니다. Reader의 렌더링·페이지 캐시·스크롤 코드는 변경하지 않았고 DB 스키마·기존 삭제 및 Cache 정책도 그대로입니다.

## Linux 앱

`scripts/install-linux.sh`는 빌드한 AppImage를 사용자 앱 경로에 복사하고 앱 목록과 바탕화면에 Paper Vocabulary 실행 아이콘을 만듭니다. 관리자 권한·개발 서버·터미널 없이 아이콘으로 실행합니다. FUSE가 없는 환경도 실행할 수 있도록 AppImage의 extract-and-run 방식을 사용합니다. 실제 앱은 프로젝트 폴더 밖에 설치되며 아이콘은 고정된 설치 경로를 가리킵니다.

기본 설치 경로는 `~/.local/share/paper-vocabulary-app/`, 앱 목록 등록은 `~/.local/share/applications/com.papervocabulary.reader.desktop`, 바탕화면은 운영체제의 Desktop 경로입니다. XDG_DATA_HOME을 지정한 환경에서는 그 경로를 사용합니다. 기존 `com.papervocabulary.reader/PaperVocabulary` DB·PDF 사본·설정을 그대로 사용합니다. 설치 설정이 없을 때만 프로젝트 `.env`를 같은 사용자의 앱 설정 경로로 복사하고 파일 권한을 600으로 제한합니다. 내용을 출력하거나 실행 아이콘·패키지에 넣지 않습니다.

기존 설치를 갱신할 때는 새 AppImage 빌드 후 같은 스크립트를 다시 실행하면 됩니다. 기존 앱 설정과 DB는 덮어쓰지 않습니다.

## 검증

전체 자동 테스트 **182개 통과**: Vitest 46, Rust 44, Playwright 92. 새 테스트는 숫자 ID와 표시 순서 선택 2개, 두 보기의 Ctrl/Command·Shift·Ctrl+Shift·키보드 선택, 확대된 사각형 선택·취소, 셔플·필터, 화면 밖 자동 스크롤과 확대 중 취소, 삭제 실패 후 재시도·숨겨진 항목 보존, 원문 복사와 검색 보호 8개입니다. 기존 Library 다중 업로드·선택·이동·삭제와 Reader/Vocabulary/인쇄/API Cache 회귀도 포함합니다.

TypeScript, Rust fmt/Clippy와 Tauri 릴리스 빌드 및 DEB/RPM/AppImage 패키징을 통과했습니다. 로그와 화면 검증 자료는 `.tools/vocabulary-selection-verification/`에 보관합니다.

별도 Xvfb·DB에서 설치 스크립트를 실행해 AppImage 바이트 일치, 실행 아이콘 형식·권한과 기존 설정 보존을 확인했습니다. 생성한 `.desktop`을 운영체제 Gio DesktopAppInfo로 실행해 터미널 없이 Linux WebKitGTK 창이 열리는지 검증했습니다. 실제 마우스로 Ctrl 선택 2개, Shift 구간 4개, 사각형 선택 2개와 Detailed View 125% 확대 후 선택을 확인했습니다. 두 항목을 삭제한 뒤 SQLite에서 나머지 단어·문맥 4개 및 외래 키 무결성을 확인했습니다. 사용자 DB와 유료 API를 테스트에 사용하지 않았습니다.

사용자 전용 경로에도 최종 앱을 설치했습니다. 바탕화면 아이콘의 `metadata::trusted=true`, 실행 권한과 `Terminal=false`를 확인했고, 앱 목록 등록도 검증했습니다. 기존 프로젝트 API 설정을 로컬 앱 설정으로 복사해 권한 600으로 보관했습니다. 사용자 DB에는 설치·검증 과정에서 쓰기를 수행하지 않았습니다.
