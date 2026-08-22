; case arith-047-sub
; expect exit=0 stdout="-864197532\n"
.func main arity=0 locals=0
  PUSH_INT 123456789
  PUSH_INT 987654321
  SUB
  PRINT
  RET
.end
