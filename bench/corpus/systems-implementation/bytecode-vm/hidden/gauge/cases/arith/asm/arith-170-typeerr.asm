; case arith-170-typeerr
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_INT 1
  ADD
  PRINT
  RET
.end
