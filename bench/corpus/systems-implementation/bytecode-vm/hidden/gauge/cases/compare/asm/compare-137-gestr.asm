; case compare-137-gestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "b"
  GE
  PRINT
  RET
.end
