; case control-044-zeroiter
; expect exit=0 stdout="after\n"
.func main arity=0 locals=1
  PUSH_INT 0
  STORE_LOCAL 0
z_top:
  LOAD_LOCAL 0
  PUSH_INT 0
  LT
  JMP_IF_FALSE z_end
  PUSH_STR "body"
  PRINT
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP z_top
z_end:
  PUSH_STR "after"
  PRINT
  RET
.end
