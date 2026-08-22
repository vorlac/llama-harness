; case arrays-020-setrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  PUSH_INT 9223372036854775807
  PUSH_INT 0
  ARR_SET
  PUSH_NIL
  PRINT
  RET
.end
