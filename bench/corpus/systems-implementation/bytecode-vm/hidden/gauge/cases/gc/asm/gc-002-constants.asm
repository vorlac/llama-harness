; case gc-002-constants
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "bb"
  GCLIVE
  PRINT
  RET
.end
