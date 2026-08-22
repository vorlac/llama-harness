; case strops-059-chrrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_INT -1
  CHR
  PRINT
  RET
.end
