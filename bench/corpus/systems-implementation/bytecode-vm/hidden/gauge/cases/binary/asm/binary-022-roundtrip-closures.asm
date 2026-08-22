; case binary-022-roundtrip-closures
; expect exit=0 stdout=""
.func main arity=0 locals=1
  CLOSURE mk
  PUSH_INT 1
  CALL 1
  STORE_LOCAL 0
  LOAD_LOCAL 0
  CALL 0
  PRINT
  RET
.end
.func mk arity=1 locals=1
  CLOSURE inner
  RET
.end
.func inner arity=0 locals=0 upvals=1
  .upval local 0
  LOAD_UPVAL 0
  PUSH_INT 1
  ADD
  DUP
  STORE_UPVAL 0
  RET
.end
