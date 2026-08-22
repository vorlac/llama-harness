; case compare-074-eqstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR ""
  EQ
  PRINT
  RET
.end
