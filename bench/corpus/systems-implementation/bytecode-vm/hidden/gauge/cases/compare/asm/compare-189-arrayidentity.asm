; case compare-189-arrayidentity
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 1
  NEW_ARRAY 1
  PUSH_INT 1
  NEW_ARRAY 1
  EQ
  PRINT
  RET
.end
