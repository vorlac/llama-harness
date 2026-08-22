; case closures-006-chain
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  CLOSURE mk1
  PUSH_INT 5
  CALL 1
  CALL 0
  CALL 0
  PRINT
  RET
.end
.func mk1 arity=1 locals=1
  CLOSURE mk2
  RET
.end
.func mk2 arity=0 locals=0 upvals=1
  .upval local 0
  CLOSURE leaf
  RET
.end
.func leaf arity=0 locals=0 upvals=1
  .upval upval 0
  LOAD_UPVAL 0
  RET
.end
