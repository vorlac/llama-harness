; case display-012-tostrlen
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 0
  TOSTR
  LEN
  PRINT
  RET
.end
