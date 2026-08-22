; case arith-202-negtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "x"
  NEG
  PRINT
  RET
.end
