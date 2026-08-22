; case display-021-tostrlen
; expect exit=0 stdout="20\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  TOSTR
  LEN
  PRINT
  RET
.end
