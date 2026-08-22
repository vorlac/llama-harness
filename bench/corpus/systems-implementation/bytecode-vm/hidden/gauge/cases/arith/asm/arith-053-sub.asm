; case arith-053-sub
; expect exit=0 stdout="9223372036854775805\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 2
  SUB
  PRINT
  RET
.end
