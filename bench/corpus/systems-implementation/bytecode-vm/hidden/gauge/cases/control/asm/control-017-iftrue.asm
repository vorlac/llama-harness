; case control-017-iftrue
; expect exit=0 stdout="done\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  JMP_IF_TRUE skip
  PUSH_STR "fell"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
