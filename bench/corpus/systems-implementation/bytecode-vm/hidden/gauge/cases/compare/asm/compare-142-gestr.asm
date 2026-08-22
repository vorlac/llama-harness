; case compare-142-gestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "Z"
  PUSH_STR "a"
  GE
  PRINT
  RET
.end
