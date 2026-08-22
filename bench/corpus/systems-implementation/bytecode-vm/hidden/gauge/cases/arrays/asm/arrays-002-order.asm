; case arrays-002-order
; expect exit=0 stdout="[1, 2, 3]\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  NEW_ARRAY 3
  PRINT
  RET
.end
