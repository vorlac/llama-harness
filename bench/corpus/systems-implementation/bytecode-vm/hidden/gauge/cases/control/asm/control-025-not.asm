; case control-025-not
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 0
  NOT
  PRINT
  RET
.end
