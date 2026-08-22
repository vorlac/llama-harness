; case arrays-030-underflow
; expect exit=4 stdout=""
; expect error=E_UNDERFLOW
.func main arity=0 locals=0
  PUSH_INT 1
  NEW_ARRAY 3
  PRINT
  RET
.end
