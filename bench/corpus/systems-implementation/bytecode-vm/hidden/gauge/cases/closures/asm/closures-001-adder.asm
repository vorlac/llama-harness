; case closures-001-adder
; expect exit=0 stdout="8\n"
.func main arity=0 locals=0
  CLOSURE make_adder
  PUSH_INT 5
  CALL 1
  PUSH_INT 3
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
