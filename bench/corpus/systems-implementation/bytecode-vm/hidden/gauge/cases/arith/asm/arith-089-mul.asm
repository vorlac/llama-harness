; case arith-089-mul
; expect exit=0 stdout="-9223372036854775808\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT -1
  MUL
  PRINT
  RET
.end
