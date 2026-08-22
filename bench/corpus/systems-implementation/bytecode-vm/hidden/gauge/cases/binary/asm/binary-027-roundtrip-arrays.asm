; case binary-027-roundtrip-arrays
; expect exit=0 stdout=""
.func main arity=0 locals=1
  NEW_ARRAY 0
  STORE_LOCAL 0
  LOAD_LOCAL 0
  PUSH_INT 1
  ARR_PUSH
  LOAD_LOCAL 0
  PUSH_INT 0
  PUSH_INT 2
  ARR_SET
  LOAD_LOCAL 0
  PUSH_INT 0
  ARR_GET
  PRINT
  LOAD_LOCAL 0
  ARR_POP
  PRINT
  LOAD_LOCAL 0
  LEN
  PRINT
  RET
.end
