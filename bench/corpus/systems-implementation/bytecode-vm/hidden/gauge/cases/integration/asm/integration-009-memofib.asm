; case integration-009-memofib
; expect exit=0 stdout="832040\n102334155\n"
.func main arity=0 locals=1
  NEW_ARRAY 0
  STORE_GLOBAL memo
  PUSH_INT 0
  STORE_LOCAL 0
f_top:
  LOAD_LOCAL 0
  PUSH_INT 41
  LT
  JMP_IF_FALSE f_end
  LOAD_GLOBAL memo
  PUSH_NIL
  ARR_PUSH
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP f_top
f_end:
  CLOSURE mfib
  PUSH_INT 30
  CALL 1
  PRINT
  CLOSURE mfib
  PUSH_INT 40
  CALL 1
  PRINT
  RET
.end
.func mfib arity=1 locals=2
  LOAD_LOCAL 0
  PUSH_INT 2
  LT
  JMP_IF_FALSE big
  LOAD_LOCAL 0
  RET
big:
  LOAD_GLOBAL memo
  LOAD_LOCAL 0
  ARR_GET
  DUP
  PUSH_NIL
  EQ
  JMP_IF_FALSE hit
  POP
  CLOSURE mfib
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  CALL 1
  CLOSURE mfib
  LOAD_LOCAL 0
  PUSH_INT 2
  SUB
  CALL 1
  ADD
  STORE_LOCAL 1
  LOAD_GLOBAL memo
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  ARR_SET
  LOAD_LOCAL 1
  RET
hit:
  RET
.end
