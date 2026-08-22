; case globals-005-nilvalue
; expect exit=0 stdout="nil\n"
.func main arity=0 locals=0
  PUSH_NIL
  STORE_GLOBAL v
  LOAD_GLOBAL v
  PRINT
  RET
.end
