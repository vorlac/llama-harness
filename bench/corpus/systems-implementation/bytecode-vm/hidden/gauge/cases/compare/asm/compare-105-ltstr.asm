; case compare-105-ltstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "ab"
  LT
  PRINT
  RET
.end
