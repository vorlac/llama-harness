; case depth-012-nocall
; expect exit=5 stdout=""
; expect error=E_STACK_OVERFLOW
.func main arity=0 locals=0
  CLOSURE f
  CALL 0
  PRINT
  RET
.end
.func f arity=0 locals=0
  PUSH_INT 1
  RET
.end
