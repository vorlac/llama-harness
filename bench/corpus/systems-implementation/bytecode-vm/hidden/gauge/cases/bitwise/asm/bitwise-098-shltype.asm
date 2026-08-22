; case bitwise-098-shltype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "x"
  PUSH_INT 1
  SHL
  PRINT
  RET
.end
