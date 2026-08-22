; case display-018-tostrlen
; expect exit=0 stdout="19\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  TOSTR
  LEN
  PRINT
  RET
.end
