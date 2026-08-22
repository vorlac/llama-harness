; case control-036-notnot
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  NOT
  NOT
  PRINT
  RET
.end
