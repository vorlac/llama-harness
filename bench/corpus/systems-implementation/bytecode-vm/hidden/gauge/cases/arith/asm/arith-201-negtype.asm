; case arith-201-negtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  NEG
  PRINT
  RET
.end
