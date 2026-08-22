; case compare-114-lestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "b"
  PUSH_STR "a"
  LE
  PRINT
  RET
.end
