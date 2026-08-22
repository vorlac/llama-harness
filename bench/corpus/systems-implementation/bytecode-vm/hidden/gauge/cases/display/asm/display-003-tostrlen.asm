; case display-003-tostrlen
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_NIL
  TOSTR
  LEN
  PRINT
  RET
.end
