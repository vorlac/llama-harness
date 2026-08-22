; case arith-054-sub
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 9223372036854775807
  SUB
  PRINT
  RET
.end
