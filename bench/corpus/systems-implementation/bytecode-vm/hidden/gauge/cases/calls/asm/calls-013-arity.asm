; case calls-013-arity
; expect exit=4 stdout=""
; expect error=E_ARITY
.func main arity=0 locals=0
  CLOSURE target
  PUSH_INT 0
  PUSH_INT 1
  CALL 2
  PRINT
  RET
.end
.func target arity=0 locals=1
  PUSH_INT 0
  RET
.end
