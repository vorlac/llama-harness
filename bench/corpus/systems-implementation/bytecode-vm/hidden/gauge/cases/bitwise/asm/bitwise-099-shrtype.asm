; case bitwise-099-shrtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "x"
  PUSH_INT 1
  SHR
  PRINT
  RET
.end
