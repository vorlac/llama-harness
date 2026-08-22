; case calls-001-simple
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  CLOSURE add
  PUSH_INT 2
  PUSH_INT 3
  CALL 2
  PRINT
  RET
.end
.func add arity=2 locals=2
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  ADD
  RET
.end
