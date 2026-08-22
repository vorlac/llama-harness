; case arith-149-divzero
; expect exit=4 stdout=""
; expect error=E_DIV_ZERO
.func main arity=0 locals=0
  PUSH_INT -1
  PUSH_INT 0
  DIV
  PRINT
  RET
.end
