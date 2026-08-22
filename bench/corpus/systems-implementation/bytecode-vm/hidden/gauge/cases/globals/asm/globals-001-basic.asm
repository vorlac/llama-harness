; case globals-001-basic
; expect exit=0 stdout="7\n"
.func main arity=0 locals=0
  PUSH_INT 7
  STORE_GLOBAL x
  LOAD_GLOBAL x
  PRINT
  RET
.end
