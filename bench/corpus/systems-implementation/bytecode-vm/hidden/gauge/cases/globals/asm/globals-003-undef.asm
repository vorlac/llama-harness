; case globals-003-undef
; expect exit=4 stdout=""
; expect error=E_UNDEF_GLOBAL
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_GLOBAL a
  LOAD_GLOBAL b
  PRINT
  RET
.end
