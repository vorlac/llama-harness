; case globals-002-undef
; expect exit=4 stdout=""
; expect error=E_UNDEF_GLOBAL
.func main arity=0 locals=0
  LOAD_GLOBAL missing
  PRINT
  RET
.end
