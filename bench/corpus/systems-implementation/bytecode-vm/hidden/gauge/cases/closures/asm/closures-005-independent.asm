; case closures-005-independent
; expect exit=0 stdout="1\n2\n1\n"
.func main arity=0 locals=2
  CLOSURE make_counter
  CALL 0
  STORE_LOCAL 0
  CLOSURE make_counter
  CALL 0
  STORE_LOCAL 1
  LOAD_LOCAL 0
  CALL 0
  PRINT
  LOAD_LOCAL 0
  CALL 0
  PRINT
  LOAD_LOCAL 1
  CALL 0
  PRINT
  RET
.end
.func make_counter arity=0 locals=1
  PUSH_INT 0
  STORE_LOCAL 0
  CLOSURE counter
  RET
.end
.func counter arity=0 locals=0 upvals=1
  .upval local 0
  LOAD_UPVAL 0
  PUSH_INT 1
  ADD
  DUP
  STORE_UPVAL 0
  RET
.end
