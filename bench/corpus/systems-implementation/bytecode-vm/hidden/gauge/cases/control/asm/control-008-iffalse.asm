; case control-008-iffalse
; expect exit=0 stdout="yes\ndone\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  JMP_IF_FALSE skip
  PUSH_STR "yes"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
