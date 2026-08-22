; case asmerr-022-missingarity
; expect exit=2 stdout=""
; expect error=E_ASM
.func main locals=0
  RET
.end
