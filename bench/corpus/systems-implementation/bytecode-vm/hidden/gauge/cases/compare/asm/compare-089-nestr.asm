; case compare-089-nestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "b"
  NE
  PRINT
  RET
.end
