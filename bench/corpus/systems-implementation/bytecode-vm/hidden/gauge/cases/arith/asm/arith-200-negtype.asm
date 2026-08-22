; case arith-200-negtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_NIL
  NEG
  PRINT
  RET
.end
