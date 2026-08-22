; case gc-030-churn
; expect exit=0 stdout="xy\n1\n"
.func main arity=0 locals=2
  PUSH_INT 0
  STORE_LOCAL 0
g_top:
  LOAD_LOCAL 0
  PUSH_INT 20000
  LT
  JMP_IF_FALSE g_end
  PUSH_STR "x"
  PUSH_STR "y"
  CONCAT
  STORE_LOCAL 1
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP g_top
g_end:
  LOAD_LOCAL 1
  PRINT
  GCLIVE
  PRINT
  RET
.end
