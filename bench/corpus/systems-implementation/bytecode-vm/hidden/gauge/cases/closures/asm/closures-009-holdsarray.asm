; case closures-009-holdsarray
; expect exit=0 stdout="[1, 2, 2]\n"
.func main arity=0 locals=1
  PUSH_INT 1
  NEW_ARRAY 1
  STORE_LOCAL 0
  CLOSURE grow
  DUP
  CALL 0
  POP
  CALL 0
  POP
  LOAD_LOCAL 0
  PRINT
  RET
.end
.func grow arity=0 locals=0 upvals=1
  .upval local 0
  LOAD_UPVAL 0
  PUSH_INT 2
  ARR_PUSH
  PUSH_NIL
  RET
.end
