; case control-034-notnot
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  NOT
  NOT
  PRINT
  RET
.end
