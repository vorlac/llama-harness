; case compare-160-nemixed
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "1"
  PUSH_INT 1
  NE
  PRINT
  RET
.end
