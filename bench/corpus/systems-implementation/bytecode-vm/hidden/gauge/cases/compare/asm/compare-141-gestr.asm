; case compare-141-gestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "ab"
  GE
  PRINT
  RET
.end
