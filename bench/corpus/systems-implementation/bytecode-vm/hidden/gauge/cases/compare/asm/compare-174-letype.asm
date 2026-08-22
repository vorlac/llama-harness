; case compare-174-letype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_NIL
  LE
  PRINT
  RET
.end
