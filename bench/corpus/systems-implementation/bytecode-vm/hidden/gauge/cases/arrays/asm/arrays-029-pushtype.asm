; case arrays-029-pushtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  ARR_PUSH
  PUSH_NIL
  PRINT
  RET
.end
