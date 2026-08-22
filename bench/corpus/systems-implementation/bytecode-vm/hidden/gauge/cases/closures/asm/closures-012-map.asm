; case closures-012-map
; expect exit=0 stdout="[2, 4, 6]\n"
.func main arity=0 locals=0
  CLOSURE map
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  NEW_ARRAY 3
  CLOSURE dbl
  CALL 2
  PRINT
  RET
.end
.func map arity=2 locals=4
  NEW_ARRAY 0
  STORE_LOCAL 2
  PUSH_INT 0
  STORE_LOCAL 3
m_top:
  LOAD_LOCAL 3
  LOAD_LOCAL 0
  LEN
  LT
  JMP_IF_FALSE m_end
  LOAD_LOCAL 2
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  LOAD_LOCAL 3
  ARR_GET
  CALL 1
  ARR_PUSH
  LOAD_LOCAL 3
  PUSH_INT 1
  ADD
  STORE_LOCAL 3
  JMP m_top
m_end:
  LOAD_LOCAL 2
  RET
.end
.func dbl arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 2
  MUL
  RET
.end
