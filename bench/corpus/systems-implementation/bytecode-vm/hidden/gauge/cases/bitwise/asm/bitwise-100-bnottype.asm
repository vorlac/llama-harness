; case bitwise-100-bnottype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  BNOT
  PRINT
  RET
.end
