; case arith-092-mul
; expect exit=0 stdout="-9223372036854775808\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 9223372036854775807
  MUL
  PRINT
  RET
.end
