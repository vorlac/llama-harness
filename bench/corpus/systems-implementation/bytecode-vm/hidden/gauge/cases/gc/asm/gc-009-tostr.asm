; case gc-009-tostr
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 5
  TOSTR
  GCLIVE
  PRINT
  RET
.end
