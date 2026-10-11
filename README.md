# Paper Vocabulary · PDF Reader, Library & Vocabulary

2026-10-08: ChatGPT 구독의 번역 모델 선택, 연속 스크롤 번역, 페이지 경계 문장의 양쪽 중복 번역, 말풍선과 원문을 잇는 점선, 독립 모델·effort 설정이 있는 논문 채팅을 추가했습니다. 채팅은 수식 표시·실시간 추가 질문·구독 잔여 비율과 이전 질문 수정/버전 전환을 지원합니다. 사용법은 [번역 기능](docs/PAGE_TRANSLATION.md)과 [ChatGPT 연결·채팅](docs/CHATGPT_CONNECTION.md)을 참고하세요.

로컬 논문 PDF에서 단어를 더블클릭하거나 텍스트를 드래그해 번역·설명을 확인하는 데스크톱 앱입니다. 번역을 사용한 단어와 구·문장만 단어장에 자동 저장하며, 단일 단어 번역은 하이라이트도 만듭니다. 설명은 결과 말풍선과 별도 캐시에만 보관합니다.

## ChatGPT 구독으로 번역하기

상단 **번역 연결 → ChatGPT 구독 → ChatGPT 로그인**에서 본인 계정으로 연결합니다. 구독의 Codex 사용 한도로 번역·설명을 처리하며 기존 API 잔액은 차감하지 않습니다. 로그인·한도 오류가 나도 유료 API로 자동 전환하지 않습니다. 공식 Codex App Server의 실험적 연결이며, 기존 API 모드도 유지합니다. 설치·저장·검증 범위는 [ChatGPT 연결](docs/CHATGPT_CONNECTION.md)을 참고하세요.

## 구현 범위

- Tauri 2 + React + TypeScript + PDF.js + SQLite(rusqlite).
- 파일 선택기 또는 앱 창에 Drag & Drop으로 PDF 한 개 또는 여러 개 열기. 빈 화면의 Drop 영역과 드래그 중 Overlay를 표시하며, Reader에서는 여러 파일 중 처음 읽을 수 있는 PDF를 열고 나머지도 Library에 보관합니다. 확장자와 PDF 헤더를 검증합니다.
- `Library`에서 논문을 앱에 보관하고 다시 엽니다. Library 홈에서 폴더·하위 폴더를 만들고 이름 변경·이동·삭제할 수 있습니다. 논문도 표시 이름 변경, 폴더 이동, 삭제를 지원합니다. Library의 `PDF 추가` 또는 Drag & Drop은 여러 PDF를 현재 선택한 폴더에 저장합니다. 파일별 제목·저자·발행일을 추출하며 일부 파일이 실패해도 나머지는 저장하고 실패한 파일명을 표시합니다. 기존 기본 폴더는 일반 폴더로 이관되며 논문과 함께 이름 변경·드래그 이동할 수 있습니다. 일반 Reader에서 새로 연 PDF는 Library 홈에 등록됩니다.
- 폴더·논문을 왼쪽 폴더에 드래그해 이동하고, 우클릭 메뉴에서 이름 변경·폴더 생성·이동·삭제를 실행합니다. 사이드바의 `＋ 폴더 생성`은 선택한 폴더 아래에 만듭니다. 상단 순서는 PDF Reader → Library → Vocabulary입니다.
- Library에서 체크박스·Ctrl(또는 Command) 클릭으로 PDF를 개별 선택하고 Shift 클릭으로 현재 정렬 순서의 구간을 선택합니다. 빈 영역에서 드래그하면 사각형 안의 PDF를 선택하고 목록 가장자리에서는 자동으로 스크롤합니다. `전체 선택`은 현재 폴더의 PDF만 선택합니다. `선택 이동`·`선택 삭제` 또는 선택한 PDF를 왼쪽 폴더로 함께 드래그해 일괄 정리할 수 있습니다. 삭제는 대상 이름·개수를 확인한 뒤 실행하며, 이동·삭제 실패 시 전체 DB 변경을 롤백하고 선택을 유지합니다. 폴더나 화면을 바꾸면 선택을 해제합니다.
- 상단 `← 뒤로가기` / `→ 앞으로가기` 또는 마우스의 뒤로/앞으로가기 보조 버튼으로 방문한 화면·Library 폴더를 오갑니다. 같은 위치를 반복 클릭해도 기록이 쌓이지 않고, 삭제된 폴더는 양쪽 기록에서 건너뜁니다. 뒤로간 뒤 다른 화면/폴더를 직접 선택하면 앞으로 갈 기록을 비웁니다. 화면 왕복 시 Reader의 스크롤·배율·페이지 캐시를 유지합니다. 파일 열기/Library 저장 중에는 이동하지 않습니다.
- Library 목록은 제목 → 메모 → 저자명 → 발행일 → 중요도(별 1~5개) → 최초 업로드 날짜 순서입니다. PDF 메타데이터와 첫 페이지에서 제목/발행일을 읽고, 저자명은 메타데이터와 첫 페이지 저자 표기에서 읽습니다. 자동 추출되지 않은 정보는 `논문 정보 수정`에서 입력합니다. 파일 생성일을 발행일로 사용하지 않으며, 제목을 추출할 수 없으면 원래 파일명을 임시 표시합니다. 중요도와 수정한 정보는 SQLite에 저장됩니다. 메모를 제외한 열 제목을 누르면 해당 기준으로 정렬하고, 같은 열을 다시 누르면 방향이 바뀝니다. 현재 방향은 화살표로 표시하며 누락된 값은 마지막에 표시합니다.
- 메모 칸의 `메모 추가` 또는 저장된 내용을 눌러 여러 줄 메모를 편집하고 `저장`합니다. `취소`/Escape는 변경을 버리고 빈 내용 저장은 메모를 지웁니다. 한글은 입력 칸 안에서 조합하며 조합 중 Escape는 메모 편집을 취소하지 않습니다. 논문별 메모는 SQLite에 보관하며 재실행·폴더 이동·PDF 재추출 후에도 유지합니다. 저장 실패 시 편집 내용을 유지해 다시 시도할 수 있습니다.
- 제목 추출에서 초록/본문 아래의 큰 장식 글자와 두 단 본문을 제외합니다. 과거에 자동 저장된 잘못된 제목과 빈 저자명은 해당 논문을 Library에서 다시 열거나 재추가하면 재추출합니다. 직접 수정한 제목·정보와 의도적으로 비운 필드는 보존합니다.
- Library의 삭제는 앱이 관리하는 PDF 사본을 제거합니다. 폴더 삭제는 하위 폴더와 포함 논문까지 적용하며 실행 전에 범위를 보여줍니다. 원본 파일, Vocabulary·문맥·하이라이트 기록과 API 비용은 유지합니다. 같은 PDF를 다시 추가하면 기존 단어 기록과 하이라이트를 사용할 수 있습니다. 자세한 동작은 [Library 구현 및 검증](docs/LIBRARY.md)을 참고하세요.
- 영어 단어 더블클릭 또는 Text Layer 드래그·삼중 클릭 → `[번역] [설명]` 버블. 저장된 Highlight가 있는 위치에는 `하이라이트 취소`도 표시합니다. `game-theoretical`, `decision-making` 같은 하이픈 단어를 지원합니다. **선택만으로 AI 호출·단어 저장·하이라이트가 발생하지 않습니다.** 발음과 `⋯` 메뉴는 제외했습니다.
- 선택한 전체 텍스트와 주변 문맥을 GPT-5.6 Luna에 전달합니다. 단일 영어 단어는 짧은 한국어 번역 또는 1~3문장 설명을 표시합니다. **번역만 Vocabulary에 자동 저장**합니다. 여러 단어·구·문장 번역도 선택한 전체 텍스트를 한 항목으로 저장합니다. 설명은 독립 캐시를 사용하며 Vocabulary·Context·조회 횟수·Highlight를 변경하지 않습니다. 이전에 저장된 설명 기록은 보존합니다. 구·문장의 자동 Highlight 생성은 기존처럼 수행하지 않습니다.
- 정상 번역 응답 후 단어·문맥·하이라이트를 하나의 SQLite 트랜잭션으로 저장. 실패·빈 응답·불완전한 응답은 저장하지 않습니다.
- 요청한 단어 위치만 오버레이 표시. PDF 좌표, 선택 범위, 페이지를 저장하고 같은 PDF를 다시 열면 복원합니다.
- 상단 Toolbar에서 확대·축소, 현재 배율, 페이지 너비 맞춤을 제공합니다. Ctrl + 마우스 휠로도 확대·축소하며, 배율 변경 뒤 선택 영역·버블·하이라이트 위치를 다시 계산합니다. 너비 맞춤은 창 크기 변경에도 유지됩니다.
- Toolbar 오른쪽에 `API ~$4.96`와 `Estimated` 표시. 초기 크레딧과 호출별 비용을 SQLite에 보관합니다.
- 단어·문장 말풍선은 선택한 원문에 붙어 PDF 스크롤과 같은 거리만큼 움직이며 화면 밖으로도 나갑니다. 가장자리에서 멈추거나 단어 위/아래 위치를 바꾸지 않으며, 다시 스크롤해 돌아오면 같은 결과가 보입니다. 말풍선을 직접 드래그하면 PDF 페이지 안의 해당 위치에 배치하며, 스크롤·줌·창 크기 변경 후에도 같은 문서 위치를 유지합니다. 모든 말풍선은 Reader 문서 안에 배치하므로 스크롤 이벤트나 React 갱신 없이 PDF와 함께 이동합니다. 긴 결과의 내부 스크롤을 끝까지 읽은 뒤 휠을 더 내리면 PDF 스크롤로 이어집니다. PDF·Text·Highlight Layer는 다시 렌더링하지 않습니다.
- PDF 연속 확대·축소는 기존 Canvas/Text/Highlight를 함께 크기 조절해 즉시 표시하고 마지막 입력 후 140ms가 지나면 최종 배율로 다시 그립니다. 기존 Text Layer와 선택 영역을 재사용하고 새 Canvas가 준비된 뒤 교체하여 빈 화면을 방지합니다. 화면 밖 텍스트의 렌더링 비용도 줄입니다. Ctrl+wheel 입력은 프레임당 한 번 처리하며 PDF 교체 시 이전 요청은 취소합니다.
- 더블클릭·드래그·삼중클릭으로 뜨는 액션 메뉴는 임시로 하나만 표시하며 바깥 클릭·새 선택·화면 전환 시 닫습니다. 번역/설명을 실행한 뒤의 진행 중·결과·오류 말풍선은 이러한 동작으로 닫히지 않습니다. `×` 또는 말풍선을 한 번 클릭한 뒤 Escape/Delete로 말풍선만 닫습니다. 이때 Vocabulary·Context·Highlight·Cache는 유지합니다. 다른 곳을 클릭한 뒤에는 이 단축키가 이전 말풍선에 적용되지 않습니다. 새 텍스트 선택은 이전 임시 메뉴를 교체하고 이미 요청한 결과는 유지합니다. 저장된 Highlight의 결과 열람도 기존처럼 유지합니다. Library·Vocabulary에서 돌아오거나 다른 PDF를 열었다가 되돌아와도 앱 실행 중에는 해당 논문의 말풍선이 복원됩니다. 말풍선을 클릭하면 원문의 정확한 단어·문장 범위를 기존 텍스트 선택 음영으로 표시합니다. 진행 중 요청은 완료 후 저장되지만 닫은 말풍선을 다시 열지 않습니다.

- 상단 `Vocabulary`에서 Simple View(영어 단어 + 한국어 뜻)와 Detailed View(단어·뜻·설명·원문 문장·논문명·페이지·조회 횟수)를 전환합니다. 영어 단어와 한국어 뜻으로 검색하며, 기존 SQLite의 Paper 목록으로 논문을 필터링합니다.
- 같은 단어의 여러 논문/페이지/문장을 Detailed View에 함께 표시합니다. 같은 논문·페이지·문장의 반복 조회는 화면에서 묶고 번역과 설명을 함께 표시합니다. 논문 필터를 선택하면 해당 논문의 문맥과 뜻을 표시합니다. Simple View는 현재 필터에 해당하는 최근 저장 뜻을 사용하며 저장된 번역이 없으면 `—`로 표시합니다. 설명만 조회한 단어의 번역을 임의로 호출하지 않습니다.
- 성공한 단어 번역마다 Lookup Count가 1 증가합니다. 설명은 증가시키지 않습니다. 캐시를 재사용한 명시적 요청도 포함하며, 단순 선택·실패·Highlight 재열람·Vocabulary 열람은 증가시키지 않습니다. 횟수는 단어 전체의 값이며 논문 필터로 변경되지 않습니다.
- Highlight를 한 번 클릭하면 해당 위치의 기존 결과를 SQLite에서 읽습니다. 같은 문맥에 저장된 다른 결과도 있으면 `뜻 보기` / `설명 보기`로 전환합니다. 이 동작은 API를 호출하거나 비용을 차감하지 않습니다. Highlight 위에서도 더블클릭과 드래그 선택은 유지됩니다.
- 단어(기존 규칙대로 대소문자/아포스트로피 정규화) + 정확히 같은 문맥 + 같은 action의 저장 결과를 API Cache로 사용합니다. 논문·페이지가 달라도 이 세 값이 같으면 재사용하며, 번역의 새로운 조회 위치에는 Context/Highlight와 Lookup Count를 저장합니다. 설명 캐시는 별도 테이블에 저장하며 Vocabulary를 만들거나 수정하지 않습니다. 앱 재시작 뒤에도 API 키 없이 캐시를 사용할 수 있습니다. 문맥이나 action이 다르면 별도로 호출합니다. 구·문장도 정확히 같은 선택 텍스트·문맥·action이면 저장 결과를 재사용합니다.

- Vocabulary의 `PDF 내보내기`는 현재 Simple/Detailed 보기와 검색·논문 필터를 반영합니다. Simple은 A4 2단의 각 단 오른쪽 끝에 한국어 뜻을 정렬합니다. Detailed는 뜻을 본문 오른쪽 끝에 정렬하며 모든 문맥을 포함합니다. 긴 뜻은 줄마다 오른쪽 정렬하고 긴 문장은 다음 페이지로 이어집니다. 한글 글꼴을 PDF에 포함하고 시스템 저장 대화상자에서 경로를 선택합니다. 기본 폴더는 `PaperVocabulary/exports`입니다. API는 호출하지 않습니다.
- Vocabulary의 `인쇄 미리보기`에서 Simple Print / Detailed Print를 전환하고 A4 페이지를 확인한 뒤 `시스템 인쇄` 또는 `PDF 저장`을 실행합니다. 현재 검색·논문 필터와 섞인 표시 순서를 반영하며, 체크박스 선택은 기존처럼 삭제에만 사용합니다. 미리보기와 저장·인쇄는 같은 PDF를 사용합니다. Linux의 시스템 프린터 대화상자에서 프린터·페이지 범위·매수를 선택합니다. 다른 운영체제에서는 PDF를 저장한 뒤 시스템 PDF 뷰어에서 인쇄해야 합니다.
- Vocabulary의 `− / % / +` 또는 `Ctrl + 마우스 휠`로 목록을 75~200% 확대·축소합니다. PDF Reader의 배율과는 독립적이며 화면을 왕복해도 유지됩니다. 일반 휠은 스크롤하고, 화면 배율은 출력 PDF의 A4 레이아웃에 영향을 주지 않습니다. 한국어 뜻은 Simple/Detailed 모두 오른쪽 끝에 정렬합니다.
- Vocabulary에서 체크박스로 한 개 이상의 항목을 선택하고 `선택 삭제`를 누르면 해당 항목의 모든 논문 문맥·조회 기록·Cache·Highlight를 함께 삭제합니다. 논문 파일, 다른 단어와 API 비용 기록은 유지합니다. 검색·논문 필터 변경 또는 Reader 이동 시 선택을 해제합니다. 삭제가 실패하면 전체 작업을 롤백하고 선택을 유지해 다시 시도할 수 있습니다.
- `전체 선택`은 현재 검색·논문 필터 결과의 모든 항목을 선택하거나 해제합니다. 일부만 선택하면 체크박스에 부분 선택 상태를 표시합니다. `순서 섞기`는 현재 목록의 표시 순서만 무작위로 변경하며 선택한 항목·뜻·문맥은 유지합니다. 두 보기와 확대·축소 중에는 순서가 유지되고, 검색·필터 변경이나 화면 재진입 등으로 DB를 다시 읽으면 기본 순서로 돌아갑니다. PDF 내보내기는 현재 표시 순서를 따릅니다.
- Vocabulary의 두 보기에서도 Ctrl/Command 클릭은 개별 선택·해제, Shift 클릭은 현재 표시 순서의 범위 선택, Ctrl+Shift 클릭은 기존 선택에 범위 추가를 수행합니다. 빈 영역에서 드래그하면 여러 항목을 선택하고 목록 가장자리에서 자동 스크롤합니다. Escape로 드래그 선택을 취소할 수 있으며 선택한 항목은 기존 `선택 삭제`로 함께 삭제합니다. 단어·문맥 텍스트 복사, 검색, 확대와 순서 섞기를 유지합니다.
- Library 논문 행과 Vocabulary 항목은 선택 후 다시 클릭하면 해당 항목만 선택 해제합니다. 아직 선택하지 않은 항목을 일반 클릭하면 그 항목만 선택하며 Ctrl/Command·Shift와 체크박스 동작은 유지합니다. Library의 논문 제목 버튼은 기존처럼 PDF를 엽니다.
- 상단에서 노랑·초록·파랑·분홍·보라 5가지 Highlight 색상을 선택합니다. 새로 생성하는 Highlight에 적용하며 기존 색상과 마지막 선택 색상은 SQLite에 보관합니다.
- 저장된 Highlight를 클릭하거나 같은 위치를 다시 선택하면 `하이라이트 취소` 또는 Delete로 해당 위치의 표시만 제거합니다. Vocabulary, Context, 조회 횟수, Cache와 비용 기록은 유지하며 Ctrl+Z로 복원할 수 있습니다. Highlight를 선택한 뒤 말풍선을 클릭하면 Delete는 말풍선만 닫습니다. 나중에 같은 위치를 다시 번역하면 캐시를 이용해 Highlight를 다시 생성합니다.

학습 상태·발음·자동 복습 기능은 포함하지 않습니다. [인쇄 구현 및 검증](docs/PHASE_3.md), [PDF 내보내기 등 사용성 기능](docs/READER_TOOLS.md), [Vocabulary 조작 및 삭제 검증 기록](docs/VOCABULARY_CONTROLS.md)을 참고하세요.

## 실행 취소 / 다시 실행

`Ctrl+Z`는 실행 취소, `Ctrl+Shift+Z`는 다시 실행입니다. macOS의 Command 키도 같은 역할입니다. Vocabulary 삭제(모든 문맥·하이라이트·캐시 포함), 하이라이트만 삭제, Library의 폴더 생성·이름 변경·이동·삭제, 논문 이동·삭제·정보·메모·중요도 수정을 지원합니다. 여러 항목의 일괄 작업도 한 단계입니다.

현재 앱 실행 중 최근 50개 작업을 기억합니다. 앱 재시작 후에는 이전 실행의 취소 기록이 남지 않으며, 되돌린 후 새 데이터 작업을 하면 다시 실행 기록을 비웁니다. API 호출·비용과 인쇄/내보내기·PDF 추가·화면 탐색·선택·정렬·Zoom은 이 기록에 포함하지 않습니다. 입력창과 한글 조합 중 Ctrl+Z는 원래의 글 편집 동작을 유지합니다.

삭제한 PDF 사본은 복원 가능한 기록이 있는 동안 보관하고 기록에서 제외되면 삭제 대기 큐를 통해 정리합니다. 앱 재시작 때도 이 큐를 정리합니다. 원본 PDF는 삭제하지 않습니다. 이후 변경된 데이터와 충돌하거나 사본이 없으면 현재 데이터를 유지하며 오류를 안내합니다. 자세한 검증은 [실행 취소 검증](docs/UNDO.md)에 있습니다.

## 앱 실행

Linux에서는 바탕화면의 **Paper Vocabulary** 아이콘을 더블클릭하거나 앱 목록에서 **Paper Vocabulary**를 검색해 실행할 수 있습니다. 터미널과 개발 서버가 필요하지 않습니다. 바탕화면에서 실행 허용을 요구하면 아이콘을 우클릭해 **실행 허용**을 선택하세요.

이 작업 환경에 빌드한 앱을 사용자 전용 경로 `~/.local/share/paper-vocabulary-app/`에 설치하고 실행 아이콘을 등록했습니다. 기존 앱 데이터 경로와 DB를 사용합니다. 설치된 앱 설정 파일이 없으면 프로젝트의 `.env`를 앱 설정 경로로 복사하고 권한을 600으로 지정하며, 기존 설치 설정은 덮어쓰지 않습니다. 키를 실행 아이콘이나 앱 패키지에 포함하지 않습니다.

새 빌드를 같은 아이콘에 반영할 때는 AppImage 빌드 후 `bash scripts/install-linux.sh`를 실행합니다. 설치 스크립트는 관리자 권한을 요구하지 않고 DB를 변경하지 않습니다. 다른 Linux 컴퓨터에는 생성된 DEB/RPM 패키지 또는 AppImage를 사용할 수 있습니다.

Ubuntu DEB 설치판은 **앱 패키지를 제거하면 사용 데이터도 자동 삭제**합니다. Ubuntu 소프트웨어 앱 및 `apt remove`/`apt purge` 모두 동일하며, 별도 선택 창은 없습니다. 앱과 연결 도구가 실행 중이면 종료 후 다시 제거하도록 안내합니다. 패키지 제거 뒤 각 사용자 계정의 앱 데이터·설정·캐시와 이 버전 실행 시 등록한 사용자 지정 XDG 경로를 해당 사용자 권한으로 정리합니다. 논문 사본·단어장·채팅·로그인 정보·앱 내부 내보내기 파일이 포함됩니다. 앱 밖의 원본 PDF와 다른 앱 데이터는 유지합니다. 같은 데이터 폴더를 쓰는 AppImage·개발 버전의 기록도 삭제되므로 필요한 자료는 미리 앱 밖에 백업하세요. **업데이트할 때는 기록을 보존**합니다. 자세한 경로와 예외는 [Ubuntu 설치 안내](packaging/ubuntu/설치안내.txt)를 참고하세요.

## 개발 실행

Windows용 설치 파일 생성과 사용 방법은 [Windows 배포](docs/WINDOWS_DISTRIBUTION.md)를 참고하세요.

Node.js **22.13 이상**과 최신 stable Rust가 필요합니다. 운영체제별 [Tauri 개발 환경](https://v2.tauri.app/start/prerequisites/)을 먼저 준비하세요.

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev libpoppler-glib-dev
```

```bash
npm ci
cp .env.example .env
chmod 600 .env
# .env 파일의 OPENAI_API_KEY= 오른쪽에 개인 API 키 입력
npm run tauri dev
```

`npm run dev`는 화면 개발용 Vite 서버만 실행합니다. 실제 로컬 파일·SQLite·AI 기능은 **`npm run tauri dev`**로 실행하세요. API 키가 없어도 PDF 열기·읽기·기존 하이라이트 복원은 가능합니다. ChatGPT 구독 방식은 API 키 없이 앱에서 로그인하여 사용합니다.

현재 작업 환경에 시스템 Node.js와 Tauri 개발 패키지가 없어서 `.tools/`에 빌드용 도구를 별도로 준비했습니다. 이 환경에서는 프로젝트 루트에서 먼저 `source .tools/env.sh`를 실행하면 됩니다. `.tools/`는 Git에 포함되지 않습니다.

## API 키와 데이터 저장

키는 Rust 백엔드에서만 읽습니다. `.env`는 Git에 포함하지 않으며, 프런트엔드용 `VITE_` 환경변수로 만들지 마세요. 우선순위는 프로세스 환경변수 → 앱 데이터 폴더의 `.env` → 개발 모드의 프로젝트 `.env`입니다. 변경 후 앱을 다시 실행하세요.

앱 데이터 루트는 Tauri의 `app_local_data_dir()/PaperVocabulary`입니다. 기본 Linux 경로:

```text
~/.local/share/com.papervocabulary.reader/PaperVocabulary/
├── .env                    # 설치된 앱에서 사용할 키 (직접 생성, 권한 600 권장)
├── database/vocabulary.db  # SQLite, WAL 모드
├── papers/<sha256>.pdf     # 원본과 바이트가 동일한 사본
├── cache/                 # 예약 폴더; API Cache는 SQLite의 문맥별 결과를 사용
└── exports/               # Vocabulary PDF 내보내기의 기본 저장 폴더
```

Windows는 `%LOCALAPPDATA%/com.papervocabulary.reader/PaperVocabulary`, macOS는 `~/Library/Application Support/com.papervocabulary.reader/PaperVocabulary`를 사용합니다. Linux의 `XDG_DATA_HOME` 등 운영체제 설정에 따라 경로는 달라질 수 있습니다.

PDF 내용의 SHA-256을 `paper_id`로 사용하므로 파일명이나 원본 위치가 달라져도 동일한 파일의 하이라이트가 복원됩니다. 원본 내용이 변경되면 별도 PDF로 인식합니다. 원본 파일에 쓰기 작업을 하지 않습니다.

API 모드의 번역·설명 시 **선택한 전체 텍스트와 주변 문맥만** OpenAI로 전송합니다. 파일명, 파일 경로, 로컬 DB는 전송하지 않습니다. [공식 모델 식별자 `gpt-5.6-luna`](https://developers.openai.com/api/docs/models/gpt-5.6-luna)와 [Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)를 사용하고 `store: false`, `reasoning.effort: none`, 작업별 출력 토큰 제한을 설정했습니다.

## API 예상 잔액

상단 오른쪽 **API 예상 잔액**을 누르고 초기 크레딧을 USD로 입력하세요. 설정 전에는 `API ~—`를 표시하며, 이미 발생한 앱 사용 비용도 계속 누적됩니다. 초기 금액을 수정해도 누적 비용은 초기화하지 않습니다. OpenAI Admin API Key를 요구하거나 저장하지 않으며 계정 잔액을 조회하지 않습니다.

API 모드의 예상 잔액은 `초기 크레딧 − 이 앱에서 완료한 API 호출의 누적 비용`입니다. ChatGPT 구독 요청은 포함하지 않습니다. 단어와 구·문장 요청 모두 비용을 기록합니다. HTTP 오류, 빈 응답, 불완전한 응답에는 비용을 차감하지 않습니다. 성공한 API 호출 후 로컬 단어 저장이 실패한 경우에는 이미 발생한 호출 비용이 남습니다.

[pricing.json](src-tauri/pricing.json)에 앱 단가를 설정했습니다. 현재 100만 토큰당 입력 $0.20, 캐시 입력 $0.02, 캐시 쓰기 $0.25, 출력 $1.20이며 [공식 Luna 가격](https://developers.openai.com/api/docs/models/gpt-5.6-luna)을 기준으로 합니다. 가격 변경 시 이 파일을 수정하고 다시 빌드하세요. 과거 호출에는 당시 단가를 보존하므로 재계산되지 않습니다.

Responses API의 실제 `input_tokens`, `output_tokens`, 캐시 토큰 세부 정보를 우선 사용합니다. 사용량이 없거나 잘못된 경우에는 요청·응답의 UTF-8 바이트 수와 메시지 여유분으로 보수적으로 추산하고, 설정 패널에 추산 건수를 표시합니다. 비용은 nanoUSD 정수로 누적해 소액 호출의 반올림 손실을 방지합니다. 앱 재시작 후에도 크레딧과 비용이 유지됩니다. 로컬 API Cache가 적중하면 Responses 호출과 사용량 기록 모두 생략합니다.

기존 DB는 데이터를 보존하면서 버전 11로 자동 업그레이드됩니다. 버전 10은 페이지 번역 캐시를, 버전 11은 설명 전용 캐시와 본문 레이아웃 캐시 버전을 추가합니다. 이전 방식의 본문 번역은 다음 명시적 번역 요청에서 다시 계산하며 자동으로 재호출하지 않습니다. 버전 9는 번역 제공자 선택을 저장합니다. 이전 이관의 Highlight 색상과 Lookup Count 복원을 유지하며, 버전 5에서 Library 폴더·논문 배치·파일 삭제 재시도 정보를 추가합니다. 버전 5 이전의 Paper는 Library 기본 폴더에 등록되며, 기존 폴더 배치는 유지합니다. 버전 6은 논문 메타데이터와 중요도를 추가하고 업로드 날짜는 기존 `added_at`을 사용합니다. 버전 7은 기존 최상위 논문을 실제 기본 폴더로 옮기고, 기존 폴더 계층은 유지합니다. 이름 충돌 시 기본 폴더 이름에 번호를 붙입니다. 자동 추출의 빈 항목은 재추가 시 다시 채우며 직접 수정한 값은 보호합니다. 버전 8은 논문별 메모(`papers.memo`, 기본 빈값)를 추가합니다. Paper, Context, Highlight 위치, 저장된 뜻·설명 및 크레딧/비용을 유지합니다.

## 구조

```text
src/
  App.tsx                    # PDF 열기·드롭, 조회 흐름, 버블 수명 관리
  components/PdfPages.tsx     # 페이지 목록과 페이지별 Highlight memoization
  components/PdfPage.tsx      # Canvas + PDF.js Text Layer + Highlight Overlay
  components/WordBubble.tsx   # 번역·설명·결과·오류 버블
  components/ApiCredit.tsx    # 예상 잔액과 초기 크레딧 설정
  components/Vocabulary.tsx  # Simple/Detailed, 단어 검색, 논문 필터
  components/PrintPreview.tsx # A4 미리보기, 인쇄 및 PDF 저장
  components/Library.tsx     # 폴더 계층, 논문 정보·중요도, 드래그 이동
  components/LibraryMenu.tsx # 우클릭 메뉴와 키보드 조작
  lib/paperMetadata.ts       # PDF 메타데이터/첫 페이지의 제목·발행일 추출
  lib/useLibraryDrag.ts      # Native PDF 드롭과 분리된 폴더·선택 논문 이동
  lib/useLibrarySelection.ts # Ctrl/Shift·사각형 다중 선택
  lib/useListSelection.ts    # Library/Vocabulary가 공유하는 선택·자동 스크롤
  lib/librarySort.ts         # 현재 폴더 논문 정렬과 누락 값 처리
  lib/vocabularyPdf.ts      # Simple/Detailed A4 PDF 생성과 한글 글꼴 포함
  lib/highlights.ts         # 5색 팔레트와 선택 위치의 Highlight 판별
  lib/selection.ts           # 단어·드래그 선택, 문맥, PDF 좌표 변환
  lib/useReaderZoom.ts       # 확대·축소, 너비 맞춤, Ctrl + 휠
  lib/pageRendering.ts       # 공유 observer, 제한된 페이지 캐시, 렌더 큐, 픽셀 상한
  lib/backend.ts             # Tauri IPC (키와 DB는 접근하지 않음)
src-tauri/
  src/desktop.rs             # 네이티브 파일 선택, IPC, 앱 초기화
  src/printing.rs            # Linux GTK/Poppler 시스템 인쇄
  src/papers.rs              # 원본을 보존하는 PDF 사본 관리
  src/ai.rs                  # Rust Responses 호출, 단어·전체 텍스트 프롬프트
  src/db.rs                  # SQLite 트랜잭션 및 하이라이트 복원
  src/library.rs             # Library 구조와 논문 배치, 삭제 및 사본 정리
  src/lookup.rs              # DB Cache 확인 → 필요할 때만 API → 조회 저장
  src/usage.rs               # 실제 토큰 파싱, 호출 비용, 초기 크레딧
  pricing.json               # 앱의 Luna 토큰 단가
  migrations/001_initial.sql # Paper / VocabularyEntry / Context / Highlight
  migrations/002_api_usage.sql # 초기 크레딧과 호출별 사용량
  migrations/003_vocabulary.sql # Lookup Count 복원 및 Cache/논문 조회 인덱스
  migrations/004_reader_tools.sql # Highlight 색상과 마지막 선택 색상
  migrations/005_library.sql # 폴더 계층과 논문 배치, PDF 삭제 재시도
  migrations/006_paper_metadata.sql # 저자·발행일·중요도·자동 추출 여부
  migrations/007_library_folders_and_metadata.sql # 일반 기본 폴더 이관·직접 입력 값 보호
tests/                       # 실제 PDF.js를 사용하는 화면 테스트
```

Text Layer가 있는 PDF를 대상으로 합니다. OCR은 구현하지 않았으며 스캔 페이지에는 텍스트 선택이 불가능하다는 안내를 표시합니다. 암호로 보호된 PDF는 지원하지 않습니다. 한 파일은 최대 256MB입니다. 보이는 페이지를 우선해 한 번에 하나의 렌더 작업을 진행하고, 최근 Canvas/Text Layer는 최대 8페이지·96MiB의 예산 안에서 재사용합니다. 화면 주변/선택 중인 페이지는 보호하므로 일시적으로 예산을 초과할 수 있습니다. Linux WebKit의 스크롤 보간 비활성화와 RAF 렌더 큐를 유지하며, Vocabulary 왕복 시 PDF 배율·스크롤 위치·페이지 캐시도 유지합니다. 문장 추출 품질은 PDF 텍스트의 내부 읽기 순서에 영향을 받습니다. 한 번에 선택한 텍스트가 12,000자를 초과하면 명시적인 오류를 표시하며, 일부만 잘라 보내지 않습니다.

최신 네이티브 앱의 스크롤·줌 측정과 Text Layer 재사용, 회귀 검증은 [Reader 추가 성능 보고서](docs/READER_MOTION_PERFORMANCE.md)에 정리했습니다. 이전 분석은 [스크롤 성능 보고서](docs/SCROLL_PERFORMANCE.md)를 참고하세요.

## 검증과 빌드

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run test:rust
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

- 좌표 테스트: 실제 PDF.js 변환으로 crop box, 0/90/180/270도 회전, 확대·축소 복원 검증.
- Rust 테스트: 원본 보존, 동일 파일 식별, SQLite 재연결 복원, 트랜잭션 롤백, API 응답 파싱 및 로컬 HTTP 서버를 통한 요청 검증. 기존 DB 마이그레이션, 전체 텍스트 전달, 구·문장 저장·캐시, 실제 토큰 비용 계산·중복 차감 방지·재연결 후 잔액도 검증합니다.
- 화면 테스트: 실제 PDF.js와 테스트용 Tauri IPC 대역으로 기존 더블클릭·번역·설명·하이라이트 생성/복원·버블 닫기 회귀를 유지합니다. 드래그·역방향 여러 줄 선택, 하이픈 단어, 확대 후 선택/버블/하이라이트 정렬, 너비 맞춤·Ctrl + 휠, 파일 드롭, 크레딧 지속성 및 실패 시 무차감을 추가로 검증합니다. IPC 대역은 테스트에만 존재합니다.
- 실제 OpenAI 통신은 API 키와 해당 모델 사용 권한이 필요합니다. 자동 테스트는 실제 API를 호출하지 않습니다.
- Linux 네이티브 실행 파일에서도 파일 선택 → PDF 표시 → 단어 버블 → 키 미설정 오류를 확인했고, 이때 단어·문맥·하이라이트는 저장되지 않으며 PDF 사본이 원본과 동일함을 확인했습니다.
- 추가로 별도 데이터 폴더의 실제 Tauri 창에서 OS 파일 드래그 → Drop Overlay → PDF 열기와 텍스트 드래그 → Action Bubble을 확인했습니다.
- 실행 취소/다시 실행 추가 후 전체 자동 테스트 198개(Vitest 46, Rust 53, Playwright 99)와 Tauri 빌드를 통과했습니다. [실행 취소 검증](docs/UNDO.md)을 참고하세요.
- Vocabulary 다중 선택과 앱 실행 아이콘 추가 후 전체 자동 테스트 182개(Vitest 46, Rust 44, Playwright 92)와 Tauri 빌드를 통과했습니다. 실제 Linux 앱 실행·선택·삭제도 검증했습니다. [Vocabulary 선택·앱 실행 검증](docs/VOCABULARY_SELECTION.md)을 참고하세요.
- 다중 PDF 업로드·선택·일괄 관리 후 전체 자동 테스트 172개(Vitest 44, Rust 44, Playwright 84)와 Tauri 빌드를 통과했습니다. [Library 다중 파일 검증](docs/LIBRARY_BATCH.md)을 참고하세요.
- Phase 2 검증은 [구현 및 회귀 검증 기록](docs/PHASE_2.md)을 참고하세요. Phase 1 테스트도 함께 유지합니다.
- Phase 3 보완 후 전체 자동 테스트 159개(Vitest 41, Rust 41, Playwright 77)와 Tauri 빌드를 통과했습니다. 학습 상태 UI 제거, 뜻 오른쪽 정렬·A4 미리보기·인쇄 전달·취소·PDF 저장과 기존 Reader/Library/Cache 회귀를 포함합니다. 실제 Linux 인쇄 대화상자의 파일 출력으로 Simple 2페이지·Detailed 25페이지를 비교했으며 자세한 범위는 [검증 기록](docs/PHASE_3.md)에 있습니다.
- 릴리스 실행 파일과 DEB/RPM/AppImage 패키지를 생성했습니다. AppImage에서도 PDF 드롭·문서 표시·저장된 잔액 복원을 확인했습니다. Xvfb에서는 첫 화면 갱신이 지연되어 창 크기를 변경한 뒤 확인했습니다.

이 작업 환경에서는 AppImage 빌드 도구를 FUSE 없이 실행하고 시스템 런타임 라이브러리를 패키징하도록 별도 경로를 준비했습니다. 이 환경의 전체 빌드 명령은 다음과 같습니다.

```bash
source .tools/env.sh
npm run tauri build -- --no-bundle
PKG_CONFIG_PATH="$PWD/.tools/bundle-pkgconfig:$PKG_CONFIG_PATH" APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri bundle
```

패키지 버전은 `package-lock.json`과 `src-tauri/Cargo.lock`에 고정합니다. 앱 실행 파일 및 설치 패키지는 `src-tauri/target/release/` 아래 생성됩니다.

PDF 생성은 [pdf-lib](https://pdf-lib.js.org/)와 fontkit을 사용하며 내보내기·미리보기를 요청할 때만 로드합니다. 내장 Nanum Gothic 글꼴과 SIL OFL 라이선스는 `src/assets/fonts/`에 포함되어 있습니다. Linux 시스템 인쇄는 GTK 3와 Poppler GLib를 사용합니다. DEB/RPM에 런타임 의존성을 선언하고 AppImage에는 해당 라이브러리를 포함합니다.

## 페이지별 본문 번역

Reader 상단 **본문 번역**을 누르면 오른쪽 번역창이 열립니다. 새 번역은 첫 페이지를 포함해 각 페이지의 **이 페이지 번역** 버튼을 눌렀을 때만 시작합니다. 번역 문장에 마우스를 올리거나 클릭하면 원문의 해당 구간이 회색으로 표시됩니다. 저장된 번역은 바로 표시하며 다시 호출하지 않습니다. 기존 번역 연결과 예상 사용량 계산을 사용합니다. 여러 줄에 걸친 원문은 문장 단위로 번역하고, 결과는 창 너비에 맞춘 문단으로 정렬합니다. 인식된 수식은 분수·첨자를 유지하는 원본 이미지로 함께 표시합니다. 사용법과 검증 범위는 [본문 번역](docs/PAGE_TRANSLATION.md)을 참고하세요.
