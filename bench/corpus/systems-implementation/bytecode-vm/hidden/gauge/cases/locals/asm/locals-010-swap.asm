; case locals-010-swap
; expect exit=0 stdout="-7\n"
.func main arity=0 locals=0
  PUSH_INT 10
  PUSH_INT 3
  SWAP
  SUB
  PRINT
  RET
.end
