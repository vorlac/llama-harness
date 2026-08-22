; case control-032-notnot
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR ""
  NOT
  NOT
  PRINT
  RET
.end
