; case arrays-005-partial
; expect exit=0 stdout="[1, 2]\n9\n"
.func main arity=0 locals=0
  PUSH_INT 9
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  PRINT
  PRINT
  RET
.end
