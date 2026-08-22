; case calls-021-underflow
; expect exit=4 stdout=""
; expect error=E_UNDERFLOW
.func main arity=0 locals=0
  CLOSURE greedy
  CALL 0
  PRINT
  RET
.end
.func greedy arity=0 locals=0
  POP
  PUSH_NIL
  RET
.end
