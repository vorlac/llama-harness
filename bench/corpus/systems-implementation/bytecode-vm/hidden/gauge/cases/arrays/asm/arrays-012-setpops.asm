; case arrays-012-setpops
; expect exit=0 stdout="7\n"
.func main arity=0 locals=1
  PUSH_INT 7
  PUSH_INT 1
  NEW_ARRAY 1
  STORE_LOCAL 0
  LOAD_LOCAL 0
  PUSH_INT 0
  PUSH_INT 5
  ARR_SET
  PRINT
  RET
.end
