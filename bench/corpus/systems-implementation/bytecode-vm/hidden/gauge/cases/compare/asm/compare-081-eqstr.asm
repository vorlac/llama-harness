; case compare-081-eqstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "ab"
  EQ
  PRINT
  RET
.end
