; case compare-140-gestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "abd"
  GE
  PRINT
  RET
.end
