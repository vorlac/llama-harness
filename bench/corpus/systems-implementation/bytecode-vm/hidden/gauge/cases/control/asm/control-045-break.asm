; case control-045-break
; expect exit=0 stdout="0\n1\n2\nstopped\n"
.func main arity=0 locals=1
  PUSH_INT 0
  STORE_LOCAL 0
top:
  LOAD_LOCAL 0
  PUSH_INT 100
  LT
  JMP_IF_FALSE out
  LOAD_LOCAL 0
  PUSH_INT 3
  EQ
  JMP_IF_TRUE out
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP top
out:
  PUSH_STR "stopped"
  PRINT
  RET
.end
