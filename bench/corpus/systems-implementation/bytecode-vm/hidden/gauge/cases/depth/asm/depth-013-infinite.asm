; case depth-013-infinite
; expect exit=5 stdout=""
; expect error=E_STACK_OVERFLOW
.func main arity=0 locals=0
  CLOSURE spin
  CALL 0
  PRINT
  RET
.end
.func spin arity=0 locals=0
  CLOSURE spin
  CALL 0
  RET
.end
