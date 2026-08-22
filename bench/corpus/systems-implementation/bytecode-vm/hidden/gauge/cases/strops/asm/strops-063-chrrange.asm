; case strops-063-chrrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  CHR
  PRINT
  RET
.end
