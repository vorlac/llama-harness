; case binary-030-roundtrip-allcompare
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  EQ
  PUSH_INT 1
  PUSH_INT 2
  NE
  EQ
  PUSH_INT 1
  PUSH_INT 2
  LT
  EQ
  PUSH_INT 1
  PUSH_INT 2
  LE
  EQ
  PUSH_INT 1
  PUSH_INT 2
  GT
  EQ
  PUSH_INT 1
  PUSH_INT 2
  GE
  EQ
  NOT
  PRINT
  RET
.end
