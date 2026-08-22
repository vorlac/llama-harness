; case arith-022-add
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 9223372036854775807
  ADD
  PRINT
  RET
.end
