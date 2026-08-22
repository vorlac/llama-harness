; case arrays-010-popempty
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  NEW_ARRAY 0
  ARR_POP
  PRINT
  RET
.end
