; case compare-159-eqmixed
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "1"
  PUSH_INT 1
  EQ
  PRINT
  RET
.end
