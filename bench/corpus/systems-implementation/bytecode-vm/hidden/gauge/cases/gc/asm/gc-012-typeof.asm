; case gc-012-typeof
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 1
  TYPEOF
  GCLIVE
  PRINT
  RET
.end
