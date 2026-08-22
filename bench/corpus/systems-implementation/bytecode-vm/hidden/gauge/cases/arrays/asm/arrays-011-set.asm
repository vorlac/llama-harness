; case arrays-011-set
; expect exit=0 stdout="[\"x\", 2]\n"
.func main arity=0 locals=1
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  STORE_LOCAL 0
  LOAD_LOCAL 0
  PUSH_INT 0
  PUSH_STR "x"
  ARR_SET
  LOAD_LOCAL 0
  PRINT
  RET
.end
