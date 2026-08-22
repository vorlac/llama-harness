; A closure, a call, and a return value.
.func main arity=0 locals=0
  CLOSURE inc
  PUSH_INT 41
  CALL 1
  PRINT
  RET
.end
.func inc arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  RET
.end
