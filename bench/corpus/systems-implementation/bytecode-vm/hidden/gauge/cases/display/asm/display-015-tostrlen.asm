; case display-015-tostrlen
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_INT -1
  TOSTR
  LEN
  PRINT
  RET
.end
