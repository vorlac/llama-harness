; case arith-187-typeerr
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  NEW_ARRAY 0
  PUSH_INT 1
  MUL
  PRINT
  RET
.end
