; case gc-025-oom
; expect exit=6 stdout=""
; expect error=E_OOM
.func main arity=0 locals=0
  NEW_ARRAY 0
  NEW_ARRAY 0
  NEW_ARRAY 0
  NEW_ARRAY 0
  NEW_ARRAY 0
  PRINT
  RET
.end
