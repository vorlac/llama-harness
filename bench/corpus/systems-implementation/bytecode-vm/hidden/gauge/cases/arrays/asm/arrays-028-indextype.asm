; case arrays-028-indextype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  NEW_ARRAY 1
  PUSH_STR "0"
  ARR_GET
  PRINT
  RET
.end
