; case control-003-iffalse
; expect exit=0 stdout="done\n"
.func main arity=0 locals=0
  PUSH_NIL
  JMP_IF_FALSE skip
  PUSH_STR "yes"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
