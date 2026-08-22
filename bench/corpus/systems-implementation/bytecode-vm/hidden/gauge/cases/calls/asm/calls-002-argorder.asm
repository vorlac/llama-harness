; case calls-002-argorder
; expect exit=0 stdout="6\n"
.func main arity=0 locals=0
  CLOSURE sub
  PUSH_INT 10
  PUSH_INT 4
  CALL 2
  PRINT
  RET
.end
.func sub arity=2 locals=2
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  SUB
  RET
.end
