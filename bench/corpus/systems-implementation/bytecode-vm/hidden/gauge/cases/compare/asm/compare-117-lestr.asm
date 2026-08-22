; case compare-117-lestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "ab"
  LE
  PRINT
  RET
.end
