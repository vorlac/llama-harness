; case strops-060-chrrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_INT 256
  CHR
  PRINT
  RET
.end
