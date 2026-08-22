; case arith-050-sub
; expect exit=0 stdout="-4294967299\n"
.func main arity=0 locals=0
  PUSH_INT -4294967296
  PUSH_INT 3
  SUB
  PRINT
  RET
.end
