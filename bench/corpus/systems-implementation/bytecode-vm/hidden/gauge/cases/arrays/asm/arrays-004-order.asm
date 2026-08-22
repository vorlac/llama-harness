; case arrays-004-order
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  NEW_ARRAY 3
  PUSH_INT 2
  ARR_GET
  PRINT
  RET
.end
