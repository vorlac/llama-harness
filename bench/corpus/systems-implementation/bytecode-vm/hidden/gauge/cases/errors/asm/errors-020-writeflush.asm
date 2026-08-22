; case errors-020-writeflush
; expect exit=4 stdout="partial"
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "partial"
  WRITE
  PUSH_NIL
  PUSH_NIL
  ADD
  RET
.end
