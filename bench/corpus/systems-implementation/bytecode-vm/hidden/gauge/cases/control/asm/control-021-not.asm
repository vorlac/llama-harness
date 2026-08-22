; case control-021-not
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_FALSE
  NOT
  PRINT
  RET
.end
