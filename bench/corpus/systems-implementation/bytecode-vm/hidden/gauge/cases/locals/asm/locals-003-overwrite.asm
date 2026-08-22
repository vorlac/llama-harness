; case locals-003-overwrite
; expect exit=0 stdout="nil\n"
.func main arity=0 locals=1
  PUSH_INT 1
  STORE_LOCAL 0
  PUSH_INT 2
  STORE_LOCAL 0
  PUSH_NIL
  STORE_LOCAL 0
  LOAD_LOCAL 0
  PRINT
  RET
.end
