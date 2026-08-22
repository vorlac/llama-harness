; case globals-008-quoted
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  PUSH_INT 5
  STORE_GLOBAL "x"
  LOAD_GLOBAL x
  PRINT
  RET
.end
