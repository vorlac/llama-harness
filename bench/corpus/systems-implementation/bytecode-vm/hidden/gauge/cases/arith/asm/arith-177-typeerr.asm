; case arith-177-typeerr
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_STR "a"
  SUB
  PRINT
  RET
.end
