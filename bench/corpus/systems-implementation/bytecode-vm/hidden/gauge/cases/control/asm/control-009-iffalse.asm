; case control-009-iffalse
; expect exit=0 stdout="yes\ndone\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  JMP_IF_FALSE skip
  PUSH_STR "yes"
  PRINT
skip:
  PUSH_STR "done"
  PRINT
  RET
.end
