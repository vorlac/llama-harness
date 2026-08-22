; case calls-008-fib
; expect exit=0 stdout="6765\n"
.func main arity=0 locals=0
  CLOSURE fib
  PUSH_INT 20
  CALL 1
  PRINT
  RET
.end
.func fib arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 2
  LT
  JMP_IF_FALSE rec
  LOAD_LOCAL 0
  RET
rec:
  CLOSURE fib
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  CALL 1
  CLOSURE fib
  LOAD_LOCAL 0
  PUSH_INT 2
  SUB
  CALL 1
  ADD
  RET
.end
