; case display-038-array
; expect exit=0 stdout="[1]\n"
.func main arity=0 locals=0
  PUSH_INT 1
  NEW_ARRAY 1
  PRINT
  RET
.end
