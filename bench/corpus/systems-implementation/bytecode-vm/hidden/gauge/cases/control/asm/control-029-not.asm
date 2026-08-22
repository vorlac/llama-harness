; case control-029-not
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT -1
  NOT
  PRINT
  RET
.end
