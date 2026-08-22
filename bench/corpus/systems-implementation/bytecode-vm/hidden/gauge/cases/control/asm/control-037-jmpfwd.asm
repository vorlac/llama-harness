; case control-037-jmpfwd
; expect exit=0 stdout="after\n"
.func main arity=0 locals=0
  JMP over
  PUSH_STR "skipped"
  PRINT
over:
  PUSH_STR "after"
  PRINT
  RET
.end
