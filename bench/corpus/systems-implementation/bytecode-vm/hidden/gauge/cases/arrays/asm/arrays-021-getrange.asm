; case arrays-021-getrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  PUSH_INT -9223372036854775808
  ARR_GET
  PRINT
  RET
.end
