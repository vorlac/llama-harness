; case binary-029-roundtrip-allarith
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  ADD
  PUSH_INT 3
  SUB
  PUSH_INT 4
  MUL
  PUSH_INT 5
  DIV
  PUSH_INT 6
  MOD
  NEG
  BNOT
  PUSH_INT 1
  BAND
  PUSH_INT 2
  BOR
  PUSH_INT 3
  BXOR
  PUSH_INT 1
  SHL
  PUSH_INT 1
  SHR
  PRINT
  RET
.end
