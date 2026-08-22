; case closures-010-higherorder
; expect exit=0 stdout="42\n"
.func main arity=0 locals=0
  CLOSURE apply
  CLOSURE dbl
  PUSH_INT 21
  CALL 2
  PRINT
  RET
.end
.func apply arity=2 locals=2
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  CALL 1
  RET
.end
.func dbl arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 2
  MUL
  RET
.end
