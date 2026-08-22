; case control-019-not
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_TRUE
  NOT
  PRINT
  RET
.end
