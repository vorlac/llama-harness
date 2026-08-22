; case closures-003-byvalue
; expect exit=0 stdout="10\n"
.func main arity=0 locals=2
  PUSH_INT 10
  STORE_LOCAL 0
  CLOSURE getter
  STORE_LOCAL 1
  PUSH_INT 99
  STORE_LOCAL 0
  LOAD_LOCAL 1
  CALL 0
  PRINT
  RET
.end
.func getter arity=0 locals=0 upvals=1
  .upval local 0
  LOAD_UPVAL 0
  RET
.end
