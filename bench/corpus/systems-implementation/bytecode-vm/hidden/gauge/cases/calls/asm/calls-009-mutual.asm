; case calls-009-mutual
; expect exit=0 stdout="true\nfalse\n"
.func main arity=0 locals=0
  CLOSURE is_even
  PUSH_INT 10
  CALL 1
  PRINT
  CLOSURE is_even
  PUSH_INT 7
  CALL 1
  PRINT
  RET
.end
.func is_even arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 0
  EQ
  JMP_IF_FALSE rec
  PUSH_TRUE
  RET
rec:
  CLOSURE is_odd
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  CALL 1
  RET
.end
.func is_odd arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 0
  EQ
  JMP_IF_FALSE rec
  PUSH_FALSE
  RET
rec:
  CLOSURE is_even
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  CALL 1
  RET
.end
