; case integration-011-pipeline
; expect exit=0 stdout="120\n[0, 4, 16, 36, 64]\n"
.func main arity=0 locals=1
  CLOSURE build
  PUSH_INT 10
  CALL 1
  STORE_LOCAL 0
  CLOSURE sum
  LOAD_LOCAL 0
  CALL 1
  PRINT
  LOAD_LOCAL 0
  PRINT
  RET
.end
.func build arity=1 locals=3
  NEW_ARRAY 0
  STORE_LOCAL 1
  PUSH_INT 0
  STORE_LOCAL 2
b_top:
  LOAD_LOCAL 2
  LOAD_LOCAL 0
  LT
  JMP_IF_FALSE b_end
  LOAD_LOCAL 2
  PUSH_INT 2
  MOD
  PUSH_INT 0
  EQ
  JMP_IF_FALSE odd
  LOAD_LOCAL 1
  LOAD_LOCAL 2
  LOAD_LOCAL 2
  MUL
  ARR_PUSH
odd:
  LOAD_LOCAL 2
  PUSH_INT 1
  ADD
  STORE_LOCAL 2
  JMP b_top
b_end:
  LOAD_LOCAL 1
  RET
.end
.func sum arity=1 locals=3
  PUSH_INT 0
  STORE_LOCAL 1
  PUSH_INT 0
  STORE_LOCAL 2
s_top:
  LOAD_LOCAL 2
  LOAD_LOCAL 0
  LEN
  LT
  JMP_IF_FALSE s_end
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  LOAD_LOCAL 2
  ARR_GET
  ADD
  STORE_LOCAL 1
  LOAD_LOCAL 2
  PUSH_INT 1
  ADD
  STORE_LOCAL 2
  JMP s_top
s_end:
  LOAD_LOCAL 1
  RET
.end
