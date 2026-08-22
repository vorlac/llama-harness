; case closures-002-twoadders
; expect exit=0 stdout="11\n101\n"
.func main arity=0 locals=2
  CLOSURE make_adder
  PUSH_INT 10
  CALL 1
  STORE_LOCAL 0
  CLOSURE make_adder
  PUSH_INT 100
  CALL 1
  STORE_LOCAL 1
  LOAD_LOCAL 0
  PUSH_INT 1
  CALL 1
  PRINT
  LOAD_LOCAL 1
  PUSH_INT 1
  CALL 1
  PRINT
  RET
.end
.func make_adder arity=1 locals=1
  CLOSURE adder
  RET
.end
.func adder arity=1 locals=1 upvals=1
  .upval local 0
  LOAD_LOCAL 0
  LOAD_UPVAL 0
  ADD
  RET
.end
