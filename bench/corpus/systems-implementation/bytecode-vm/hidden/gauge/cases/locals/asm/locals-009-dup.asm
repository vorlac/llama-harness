; case locals-009-dup
; expect exit=0 stdout="8\n"
.func main arity=0 locals=0
  PUSH_INT 4
  DUP
  ADD
  PRINT
  RET
.end
