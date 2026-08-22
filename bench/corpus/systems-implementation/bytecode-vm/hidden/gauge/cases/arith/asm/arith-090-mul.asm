; case arith-090-mul
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT -9223372036854775808
  MUL
  PRINT
  RET
.end
