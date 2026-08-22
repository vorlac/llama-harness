; case arrays-033-nestedget
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  PUSH_INT 3
  PUSH_INT 4
  NEW_ARRAY 2
  NEW_ARRAY 2
  PUSH_INT 1
  ARR_GET
  PUSH_INT 0
  ARR_GET
  PRINT
  RET
.end
