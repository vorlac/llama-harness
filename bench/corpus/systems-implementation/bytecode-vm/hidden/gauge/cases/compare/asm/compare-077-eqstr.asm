; case compare-077-eqstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "b"
  EQ
  PRINT
  RET
.end
