; case calls-006-nested
; expect exit=0 stdout="120\n"
.func main arity=0 locals=0
  CLOSURE outer
  PUSH_INT 5
  CALL 1
  PRINT
  RET
.end
.func outer arity=1 locals=1
  CLOSURE inner
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  CALL 1
  PUSH_INT 10
  MUL
  RET
.end
.func inner arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 2
  MUL
  RET
.end
