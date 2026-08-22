; case control-054-max3
; expect exit=0 stdout="5\n"
.func main arity=0 locals=1
  PUSH_INT 5
  STORE_LOCAL 0
  PUSH_INT 5
  LOAD_LOCAL 0
  GT
  JMP_IF_FALSE k1
  PUSH_INT 5
  STORE_LOCAL 0
k1:
  PUSH_INT 5
  LOAD_LOCAL 0
  GT
  JMP_IF_FALSE k2
  PUSH_INT 5
  STORE_LOCAL 0
k2:
  LOAD_LOCAL 0
  PRINT
  RET
.end
