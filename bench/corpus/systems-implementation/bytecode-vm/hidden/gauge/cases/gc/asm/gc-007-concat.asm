; case gc-007-concat
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "b"
  CONCAT
  POP
  GCLIVE
  PRINT
  RET
.end
