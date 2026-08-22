; case display-009-tostrlen
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  PUSH_FALSE
  TOSTR
  LEN
  PRINT
  RET
.end
