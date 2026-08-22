; case compare-119-lestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "~"
  PUSH_STR "!"
  LE
  PRINT
  RET
.end
