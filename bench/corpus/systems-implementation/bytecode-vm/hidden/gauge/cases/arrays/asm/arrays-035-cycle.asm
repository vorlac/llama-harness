; case arrays-035-cycle
; expect exit=0 stdout="[[[...]]]\n"
.func main arity=0 locals=2
  NEW_ARRAY 0
  STORE_LOCAL 0
  NEW_ARRAY 0
  STORE_LOCAL 1
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  ARR_PUSH
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  ARR_PUSH
  LOAD_LOCAL 0
  PRINT
  RET
.end
