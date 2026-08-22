; case control-012-iftrue
; expect exit=0 stdout="fell\ndone\n"
.func main arity=0 locals=0
  PUSH_NIL
  JMP_IF_TRUE skip
  PUSH_STR "fell"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
