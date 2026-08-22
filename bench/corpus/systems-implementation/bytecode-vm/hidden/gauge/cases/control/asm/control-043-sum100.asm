; case control-043-sum100
; expect exit=0 stdout="5050\n"
.func main arity=0 locals=2
  PUSH_INT 0
  STORE_LOCAL 1
  PUSH_INT 1
  STORE_LOCAL 0
s_top:
  LOAD_LOCAL 0
  PUSH_INT 101
  LT
  JMP_IF_FALSE s_end
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  ADD
  STORE_LOCAL 1
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP s_top
s_end:
  LOAD_LOCAL 1
  PRINT
  RET
.end
