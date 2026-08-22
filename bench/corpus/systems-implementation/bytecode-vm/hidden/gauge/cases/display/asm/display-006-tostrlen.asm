; case display-006-tostrlen
; expect exit=0 stdout="4\n"
.func main arity=0 locals=0
  PUSH_TRUE
  TOSTR
  LEN
  PRINT
  RET
.end
