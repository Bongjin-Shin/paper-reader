; User data is outside $INSTDIR and must never be cleared during an upgrade.
!macro NSIS_HOOK_PREINSTALL
  SetOverwrite on
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Do not report a successful update if a locked/skipped executable stayed old.
  Push $0
  Push $1
  Push $2
  Push $3
  ClearErrors
  GetDLLVersion "$INSTDIR\${MAINBINARYNAME}.exe" $0 $1
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "앱 실행 파일을 확인하지 못했습니다. 앱을 종료한 뒤 설치를 다시 실행해 주세요. / Cannot verify the installed application."
    SetErrorLevel 2
    Abort
  ${EndIf}
  GetDLLVersionLocal "${MAINBINARYSRCPATH}" $2 $3
  ${If} $0 != $2
  ${OrIf} $1 != $3
    MessageBox MB_ICONSTOP|MB_OK "새 버전으로 교체되지 않았습니다. 앱을 종료한 뒤 같은 설치 경로로 다시 설치해 주세요. 저장된 데이터는 삭제할 필요가 없습니다. / Application update was not applied."
    SetErrorLevel 2
    Abort
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
