; case arrays-008-push
; expect exit=0 stdout="[1, 2]\n2\n"
.func main arity=0 locals=1
  NEW_ARRAY 0
  STORE_LOCAL 0
  LOAD_LOCAL 0
  PUSH_INT 1
  ARR_PUSH
  LOAD_LOCAL 0
  PUSH_INT 2
  ARR_PUSH
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 0
  LEN
  PRINT
  RET
.end
