; case calls-011-arity
; expect exit=4 stdout=""
; expect error=E_ARITY
.func main arity=0 locals=0
  CLOSURE target
  PUSH_INT 0
  PUSH_INT 1
  PUSH_INT 2
  CALL 3
  PRINT
  RET
.end
.func target arity=2 locals=2
  PUSH_INT 0
  RET
.end
