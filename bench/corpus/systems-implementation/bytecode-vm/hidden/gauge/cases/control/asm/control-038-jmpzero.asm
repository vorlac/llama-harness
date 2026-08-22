; case control-038-jmpzero
; expect exit=0 stdout="fallthrough\n"
.func main arity=0 locals=0
  JMP next
next:
  PUSH_STR "fallthrough"
  PRINT
  RET
.end
