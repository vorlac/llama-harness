; case depth-015-recovered
; expect exit=0 stdout="60\n"
.func main arity=0 locals=1
  CLOSURE down
  PUSH_INT 30
  CALL 1
  STORE_LOCAL 0
  CLOSURE down
  PUSH_INT 30
  CALL 1
  LOAD_LOCAL 0
  ADD
  PRINT
  RET
.end
.func down arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 0
  EQ
  JMP_IF_FALSE rec
  PUSH_INT 0
  RET
rec:
  PUSH_INT 1
  CLOSURE down
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  CALL 1
  ADD
  RET
.end
