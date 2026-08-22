; case compare-080-eqstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "abd"
  EQ
  PRINT
  RET
.end
