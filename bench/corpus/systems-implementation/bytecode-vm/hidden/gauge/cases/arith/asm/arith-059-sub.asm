; case arith-059-sub
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT -9223372036854775808
  SUB
  PRINT
  RET
.end
