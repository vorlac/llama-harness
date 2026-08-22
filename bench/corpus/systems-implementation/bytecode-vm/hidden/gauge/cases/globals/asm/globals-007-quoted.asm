; case globals-007-quoted
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  PUSH_INT 5
  STORE_GLOBAL "odd name"
  LOAD_GLOBAL "odd name"
  PRINT
  RET
.end
