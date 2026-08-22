; case arrays-031-alias
; expect exit=0 stdout="[1]\n"
.func main arity=0 locals=2
  NEW_ARRAY 0
  STORE_LOCAL 0
  LOAD_LOCAL 0
  STORE_LOCAL 1
  LOAD_LOCAL 0
  PUSH_INT 1
  ARR_PUSH
  LOAD_LOCAL 1
  PRINT
  RET
.end
