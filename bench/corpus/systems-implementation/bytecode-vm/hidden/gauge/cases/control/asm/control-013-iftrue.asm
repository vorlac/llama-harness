; case control-013-iftrue
; expect exit=0 stdout="done\n"
.func main arity=0 locals=0
  PUSH_INT 0
  JMP_IF_TRUE skip
  PUSH_STR "fell"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
