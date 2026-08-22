; case control-018-iftrue
; expect exit=0 stdout="done\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  JMP_IF_TRUE skip
  PUSH_STR "fell"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
