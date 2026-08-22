; case display-024-tostrlen
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  PUSH_STR "plain"
  TOSTR
  LEN
  PRINT
  RET
.end
