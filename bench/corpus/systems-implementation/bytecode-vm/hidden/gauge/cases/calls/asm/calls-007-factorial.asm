; case calls-007-factorial
; expect exit=0 stdout="3628800\n"
.func main arity=0 locals=0
  CLOSURE fact
  PUSH_INT 10
  CALL 1
  PRINT
  RET
.end
.func fact arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 1
  LE
  JMP_IF_FALSE rec
  PUSH_INT 1
  RET
rec:
  LOAD_LOCAL 0
  CLOSURE fact
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  CALL 1
  MUL
  RET
.end
