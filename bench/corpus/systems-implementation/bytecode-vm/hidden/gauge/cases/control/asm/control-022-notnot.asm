; case control-022-notnot
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_FALSE
  NOT
  NOT
  PRINT
  RET
.end
