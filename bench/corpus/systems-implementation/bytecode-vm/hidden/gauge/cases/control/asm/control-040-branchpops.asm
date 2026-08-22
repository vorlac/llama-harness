; case control-040-branchpops
; expect exit=0 stdout="222\n"
.func main arity=0 locals=0
  PUSH_INT 222
  PUSH_TRUE
  JMP_IF_FALSE k
k:
  PRINT
  RET
.end
