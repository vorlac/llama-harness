; case bitwise-066-shl
; expect exit=0 stdout="1152921504606846976\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 60
  SHL
  PRINT
  RET
.end
