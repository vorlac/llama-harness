; case display-007-print
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_FALSE
  PRINT
  RET
.end
