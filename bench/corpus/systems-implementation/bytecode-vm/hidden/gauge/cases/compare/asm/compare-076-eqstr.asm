; case compare-076-eqstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "a"
  EQ
  PRINT
  RET
.end
