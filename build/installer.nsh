; PrintLog uninstaller: when the user removes the app by hand, offer to delete its settings and data too.
; During an update the old version is uninstalled first (isUpdated) - then nothing is deleted and nothing is asked.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent pl_done
    MessageBox MB_YESNO|MB_ICONQUESTION "למחוק גם את ההגדרות והנתונים של PrintLog?$\r$\n(החיבור ל-Bambu ול-Google Drive, ההעדפות והמטמון)$\r$\n$\r$\nתיקיית המודלים שלך והקבצים ב-Google Drive לא יימחקו." /SD IDNO IDNO pl_done
      SetShellVarContext current
      RMDir /r "$APPDATA\Model Shelf"
      RMDir /r "$APPDATA\PrintLog"
    pl_done:
  ${endIf}
!macroend
