; case compare-139-gestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "ab"
  PUSH_STR "b"
  GE
  PRINT
  RET
.end
