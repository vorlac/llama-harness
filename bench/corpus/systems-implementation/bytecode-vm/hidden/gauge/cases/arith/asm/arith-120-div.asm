; case arith-120-div
; expect exit=0 stdout="-65536\n"
.func main arity=0 locals=0
  PUSH_INT -4294967296
  PUSH_INT 65536
  DIV
  PRINT
  RET
.end
