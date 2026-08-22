; case control-028-notnot
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 1
  NOT
  NOT
  PRINT
  RET
.end
