; case arrays-025-gettype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_INT 0
  ARR_GET
  PRINT
  RET
.end
