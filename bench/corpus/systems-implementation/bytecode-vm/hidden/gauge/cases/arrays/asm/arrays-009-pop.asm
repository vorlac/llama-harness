; case arrays-009-pop
; expect exit=0 stdout="3\n[1, 2]\n2\n"
.func main arity=0 locals=1
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  NEW_ARRAY 3
  STORE_LOCAL 0
  LOAD_LOCAL 0
  ARR_POP
  PRINT
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 0
  LEN
  PRINT
  RET
.end
