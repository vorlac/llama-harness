; case compare-188-arrayidentity
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  NEW_ARRAY 0
  EQ
  PRINT
  RET
.end
