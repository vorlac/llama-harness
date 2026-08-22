; case compare-082-eqstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "Z"
  PUSH_STR "a"
  EQ
  PRINT
  RET
.end
