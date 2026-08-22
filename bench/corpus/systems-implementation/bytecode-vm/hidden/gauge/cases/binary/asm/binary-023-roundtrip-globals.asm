; case binary-023-roundtrip-globals
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_GLOBAL a
  PUSH_INT 2
  STORE_GLOBAL "b c"
  LOAD_GLOBAL a
  LOAD_GLOBAL "b c"
  ADD
  PRINT
  RET
.end
