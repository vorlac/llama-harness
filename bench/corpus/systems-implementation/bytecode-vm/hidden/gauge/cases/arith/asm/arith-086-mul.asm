; case arith-086-mul
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 9223372036854775807
  MUL
  PRINT
  RET
.end
