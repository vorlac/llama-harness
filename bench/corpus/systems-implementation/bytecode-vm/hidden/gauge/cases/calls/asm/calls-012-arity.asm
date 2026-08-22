; case calls-012-arity
; expect exit=4 stdout=""
; expect error=E_ARITY
.func main arity=0 locals=0
  CLOSURE target
  CALL 0
  PRINT
  RET
.end
.func target arity=1 locals=1
  PUSH_INT 0
  RET
.end
