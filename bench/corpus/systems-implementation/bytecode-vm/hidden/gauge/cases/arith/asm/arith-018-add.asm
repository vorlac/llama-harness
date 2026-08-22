; case arith-018-add
; expect exit=0 stdout="-4294967293\n"
.func main arity=0 locals=0
  PUSH_INT -4294967296
  PUSH_INT 3
  ADD
  PRINT
  RET
.end
