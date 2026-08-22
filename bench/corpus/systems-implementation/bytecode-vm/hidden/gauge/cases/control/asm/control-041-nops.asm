; case control-041-nops
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  NOP
  NOP
  PUSH_INT 5
  NOP
  PRINT
  NOP
  RET
.end
