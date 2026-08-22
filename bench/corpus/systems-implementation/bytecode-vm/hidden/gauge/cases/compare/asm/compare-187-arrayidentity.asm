; case compare-187-arrayidentity
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  DUP
  EQ
  PRINT
  RET
.end
