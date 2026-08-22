; case bitwise-084-shlrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 64
  SHL
  PRINT
  RET
.end
