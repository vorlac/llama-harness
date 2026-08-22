; case control-020-notnot
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_TRUE
  NOT
  NOT
  PRINT
  RET
.end
