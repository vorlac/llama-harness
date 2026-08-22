; case display-010-print
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PRINT
  RET
.end
