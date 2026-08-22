; case control-002-iffalse
; expect exit=0 stdout="done\n"
.func main arity=0 locals=0
  PUSH_FALSE
  JMP_IF_FALSE skip
  PUSH_STR "yes"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
