; case arrays-032-nested
; expect exit=0 stdout="[[1, 2], [3, 4]]\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  PUSH_INT 3
  PUSH_INT 4
  NEW_ARRAY 2
  NEW_ARRAY 2
  PRINT
  RET
.end
