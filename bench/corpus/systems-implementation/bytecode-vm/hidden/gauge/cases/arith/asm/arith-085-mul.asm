; case arith-085-mul
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 2
  MUL
  PRINT
  RET
.end
