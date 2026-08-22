; case binary-031-roundtrip-stackops
; expect exit=0 stdout=""
.func main arity=0 locals=0
  NOP
  PUSH_INT 1
  DUP
  SWAP
  POP
  PUSH_NIL
  POP
  PUSH_TRUE
  POP
  PUSH_FALSE
  POP
  ASSERT
  GC
  GCLIVE
  PRINT
  HALT
.end
