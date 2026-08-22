; case control-039-branchpops
; expect exit=0 stdout="111\n"
.func main arity=0 locals=0
  PUSH_INT 111
  PUSH_FALSE
  JMP_IF_FALSE k
  PUSH_STR "no"
  PRINT
k:
  PRINT
  RET
.end
