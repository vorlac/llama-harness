; case display-020-tostr
; expect exit=0 stdout="-9223372036854775808\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  TOSTR
  PRINT
  RET
.end
