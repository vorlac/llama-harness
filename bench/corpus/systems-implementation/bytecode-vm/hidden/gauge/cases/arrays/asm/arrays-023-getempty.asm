; case arrays-023-getempty
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  NEW_ARRAY 0
  PUSH_INT 0
  ARR_GET
  PRINT
  RET
.end
