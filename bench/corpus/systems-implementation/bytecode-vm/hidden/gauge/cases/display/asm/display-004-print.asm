; case display-004-print
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_TRUE
  PRINT
  RET
.end
