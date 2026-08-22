; case gc-034-retained
; expect exit=0 stdout="500\n501\n"
.func main arity=0 locals=2
  NEW_ARRAY 0
  STORE_LOCAL 1
  PUSH_INT 0
  STORE_LOCAL 0
g_top:
  LOAD_LOCAL 0
  PUSH_INT 500
  LT
  JMP_IF_FALSE g_end
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  TOSTR
  ARR_PUSH
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP g_top
g_end:
  LOAD_LOCAL 1
  LEN
  PRINT
  GCLIVE
  PRINT
  RET
.end
