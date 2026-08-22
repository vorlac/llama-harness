; case gc-010-chr
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 65
  CHR
  GCLIVE
  PRINT
  RET
.end
