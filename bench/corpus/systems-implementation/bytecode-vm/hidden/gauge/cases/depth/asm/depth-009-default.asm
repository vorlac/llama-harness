; case depth-009-default
; expect exit=0 stdout="254\n"
.func main arity=0 locals=0
  CLOSURE down
  PUSH_INT 254
  CALL 1
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
