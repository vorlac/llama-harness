; case errors-006-e_undef_global
; expect exit=4 stdout="before\n"
; expect error=E_UNDEF_GLOBAL
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  LOAD_GLOBAL nope
  RET
.end
