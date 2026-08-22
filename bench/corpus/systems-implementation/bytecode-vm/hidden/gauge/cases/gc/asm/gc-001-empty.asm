; case gc-001-empty
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  GCLIVE
  PRINT
  RET
.end
