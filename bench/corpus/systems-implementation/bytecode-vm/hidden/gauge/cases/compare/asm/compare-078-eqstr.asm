; case compare-078-eqstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "b"
  PUSH_STR "a"
  EQ
  PRINT
  RET
.end
